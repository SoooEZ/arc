package dev.arc.rule;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.MemoizingRuleResolver;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.execution.Parameters;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceExecutionService;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/** Coordinates preparation and execution with isolated inputs, source reads and deadlines. */
@Service
public class RuleExecutionService {
  /**
   * The options an execution or a preview may set; a null field means its default. Both request
   * records keep the two fields flat and hand them over through {@code options()}: an unwrapped or
   * nested object would let an unknown request field through unnamed (lesson B32).
   */
  public record ExecutionOptions(Boolean trace, Integer timeoutMs) {
    /** Trace collection is on unless the request turned it off. */
    public boolean traceEnabled() {
      return trace == null || trace;
    }

    /** Starts the shared deadline: the requested timeout, else 30,000 ms; out of range is a 422. */
    public ExecutionDeadline startDeadline() {
      return ExecutionDeadline.start(
          timeoutMs == null ? ExecutionDeadline.DEFAULT_TIMEOUT_MS : timeoutMs);
    }
  }

  public record Execution(
      Map<String, Object> inputs, Integer version, Boolean trace, Integer timeoutMs) {
    public Execution(Map<String, Object> inputs, Integer version) {
      this(inputs, version, null, null);
    }

    public ExecutionOptions options() {
      return new ExecutionOptions(trace, timeoutMs);
    }
  }

  public record Preview(
      Definition definition, Map<String, Object> inputs, Boolean trace, Integer timeoutMs) {
    public Preview(Definition definition, Map<String, Object> inputs) {
      this(definition, inputs, null, null);
    }

    public ExecutionOptions options() {
      return new ExecutionOptions(trace, timeoutMs);
    }
  }

  public record Timing(long preparationMicros, long executionMicros, long totalMicros) {}

  /**
   * The execution endpoint's response. The engine result's fields are written inline between {@code
   * version} and {@code timing}, so the JSON has no nested {@code execution} object.
   */
  public record ExecutionResponse(
      String ruleId, Integer version, @JsonUnwrapped Engine.Result execution, Timing timing) {}

  private final RuleRepository rules;
  private final SourceBindingValidator sourceContracts;
  private final Engine engine;
  private final SourceExecutionService sources;

  public RuleExecutionService(
      RuleRepository rules,
      SourceBindingValidator sourceContracts,
      Engine engine,
      SourceExecutionService sources) {
    this.rules = rules;
    this.sourceContracts = sourceContracts;
    this.engine = engine;
    this.sources = sources;
  }

  public ExecutionResponse execute(String id, Execution request) {
    return EvaluationThreads.run(() -> executePublished(id, request));
  }

  public ExecutionResponse preview(Preview request) {
    return EvaluationThreads.run(() -> previewDraft(request));
  }

  private ExecutionResponse executePublished(String id, Execution request) {
    var run = new Run(request.options());
    Integer version = request.version() == null ? rules.publishedVersion(id) : request.version();
    if (version == null)
      throw ArcException.conflict("Publish this rule before calling its execution endpoint");
    run.deadline.check();
    // The pinned version is read and decoded only when no compiled plan of it is cached.
    return run.evaluate(id, version, () -> run.resolver.resolve(id, version), request.inputs());
  }

  private ExecutionResponse previewDraft(Preview request) {
    var run = new Run(request.options());
    Definition draft = request.definition();
    return run.evaluate("preview", null, () -> draft, request.inputs());
  }

  /**
   * One execution or preview: its clock, its options, the deadline they start and the resolver that
   * reads inside it, all created before any read.
   */
  private final class Run {
    private final long start = System.nanoTime();
    private final ExecutionOptions options;
    private final ExecutionDeadline deadline;
    private final RuleResolver resolver;

    Run(ExecutionOptions options) {
      this.options = options;
      this.deadline = options.startDeadline();
      this.resolver = resolver(deadline);
    }

    ExecutionResponse evaluate(
        String id, Integer version, Supplier<Definition> definition, Map<String, Object> inputs) {
      var sourceSession = sources.openSession();
      var execution = engine.session(resolver, deadline);
      try {
        var prepared = execution.prepare(id, version, definition);
        // A cached published plan keeps its verdict: its pins and source versions are immutable.
        execution.verifyOnce(
            id,
            version,
            () ->
                sourceContracts.validateForExecution(
                    prepared.definition(),
                    resolver,
                    (sourceId, sourceVersion) ->
                        deadline.within(() -> sourceSession.definition(sourceId, sourceVersion))));
      } catch (ArcException error) {
        // A published version names itself in its root location, as its runtime failures do; a
        // preview (null version) keeps the shown graph's locations unnamed.
        throw version == null ? error : error.inRule(id, version);
      }
      deadline.check();
      long preparationMicros = (System.nanoTime() - start) / 1000;
      var result =
          execution.execute(
              id,
              version,
              definition,
              inputs,
              new Parameters(sourceSession),
              options.traceEnabled());
      long totalMicros = (System.nanoTime() - start) / 1000;
      return new ExecutionResponse(
          id, version, result, new Timing(preparationMicros, result.durationMicros(), totalMicros));
    }
  }

  /**
   * Every definition read runs inside the deadline, so an expired request starts no later query. A
   * pin whose plan an execution cached is served from that plan ({@link Engine#cachedFirst})
   * instead of being read and decoded again: a preview's compile and its source-contract walk read
   * every reached pin from storage on each request before, although its execution ran the cached
   * plans. Formula calls still ask storage, which checks the rule's kind.
   */
  private RuleResolver resolver(ExecutionDeadline deadline) {
    var storage =
        new RuleResolver() {
          @Override
          public Definition resolve(String id, int version) {
            return deadline.within(() -> rules.resolve(id, version));
          }

          @Override
          public Definition resolveFormula(String id, int version) {
            return deadline.within(() -> rules.resolveFormula(id, version));
          }
        };
    return new MemoizingRuleResolver(engine.cachedFirst(storage));
  }
}
