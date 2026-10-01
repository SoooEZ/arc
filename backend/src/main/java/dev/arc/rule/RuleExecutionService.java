package dev.arc.rule;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.MemoizingRuleResolver;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.execution.Parameters;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.source.SourceExecutionService;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/** Coordinates preparation and execution with isolated inputs, source reads and deadlines. */
@Service
public class RuleExecutionService {
  public record Execution(
      Map<String, Object> inputs, Integer version, Boolean trace, Integer timeoutMs) {
    public Execution(Map<String, Object> inputs, Integer version) {
      this(inputs, version, null, null);
    }
  }

  public record Preview(
      Definition definition, Map<String, Object> inputs, Boolean trace, Integer timeoutMs) {
    public Preview(Definition definition, Map<String, Object> inputs) {
      this(definition, inputs, null, null);
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
  private final RuleDefinitionService definitions;
  private final Engine engine;
  private final SourceExecutionService sources;

  public RuleExecutionService(
      RuleRepository rules,
      RuleDefinitionService definitions,
      Engine engine,
      SourceExecutionService sources) {
    this.rules = rules;
    this.definitions = definitions;
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
    long start = System.nanoTime();
    ExecutionDeadline deadline = deadline(request.timeoutMs());
    Integer version = request.version() == null ? rules.publishedVersion(id) : request.version();
    if (version == null)
      throw new ArcException(409, "Publish this rule before calling its execution endpoint");
    var resolver = resolver(deadline);
    deadline.check();
    // The pinned version is read and decoded only when no compiled plan of it is cached.
    return evaluate(
        id,
        version,
        () -> resolver.resolve(id, version),
        request.inputs(),
        resolver,
        request.trace(),
        deadline,
        start);
  }

  private ExecutionResponse previewDraft(Preview request) {
    long start = System.nanoTime();
    ExecutionDeadline deadline = deadline(request.timeoutMs());
    Definition draft = request.definition();
    return evaluate(
        "preview",
        null,
        () -> draft,
        request.inputs(),
        resolver(deadline),
        request.trace(),
        deadline,
        start);
  }

  private ExecutionResponse evaluate(
      String id,
      Integer version,
      Supplier<Definition> definition,
      Map<String, Object> inputs,
      RuleResolver resolver,
      Boolean requestedTrace,
      ExecutionDeadline deadline,
      long start) {
    var sourceSession = sources.openSession();
    var execution = engine.session(resolver, deadline);
    try {
      var prepared = execution.prepare(id, version, definition);
      // A cached published plan keeps its verdict: its pins and source versions are immutable.
      execution.verifyOnce(
          id,
          version,
          () ->
              definitions.validateSources(
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
            requestedTrace == null || requestedTrace);
    long totalMicros = (System.nanoTime() - start) / 1000;
    return new ExecutionResponse(
        id, version, result, new Timing(preparationMicros, result.durationMicros(), totalMicros));
  }

  /**
   * Every definition read runs inside the deadline, so an expired request starts no later query.
   */
  private RuleResolver resolver(ExecutionDeadline deadline) {
    return new MemoizingRuleResolver(
        new RuleResolver() {
          @Override
          public Definition resolve(String id, int version) {
            return deadline.within(() -> rules.resolve(id, version));
          }

          @Override
          public Definition resolveFormula(String id, int version) {
            return deadline.within(() -> rules.resolveFormula(id, version));
          }
        });
  }

  private static ExecutionDeadline deadline(Integer timeoutMs) {
    return ExecutionDeadline.start(
        timeoutMs == null ? ExecutionDeadline.DEFAULT_TIMEOUT_MS : timeoutMs);
  }
}
