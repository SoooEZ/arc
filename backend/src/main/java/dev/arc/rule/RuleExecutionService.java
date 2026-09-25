package dev.arc.rule;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.MemoizingRuleResolver;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.execution.Parameters;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.source.SourceExecutionService;
import java.util.List;
import java.util.Map;
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

  public record ExecutionResponse(
      String ruleId,
      Integer version,
      Object result,
      List<Engine.Step> trace,
      long durationMicros,
      List<Parameters.Read> sources,
      boolean traceEnabled,
      boolean traceTruncated,
      int executedSteps,
      int traceBytes,
      Timing timing) {}

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
    long start = System.nanoTime();
    ExecutionDeadline deadline = deadline(request.timeoutMs());
    Integer version = request.version() == null ? rules.publishedVersion(id) : request.version();
    if (version == null)
      throw new ArcException(409, "Publish this rule before calling its execution endpoint");
    var resolver = resolver(deadline);
    deadline.check();
    Definition definition = resolver.resolve(id, version);
    return evaluate(
        id, version, definition, request.inputs(), resolver, request.trace(), deadline, start);
  }

  public ExecutionResponse preview(Preview request) {
    long start = System.nanoTime();
    ExecutionDeadline deadline = deadline(request.timeoutMs());
    return evaluate(
        "preview",
        null,
        request.definition(),
        request.inputs(),
        resolver(deadline),
        request.trace(),
        deadline,
        start);
  }

  private ExecutionResponse evaluate(
      String id,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver,
      Boolean requestedTrace,
      ExecutionDeadline deadline,
      long start) {
    var sourceSession = sources.openSession();
    var execution = engine.session(resolver, deadline);
    var prepared = execution.prepare(id, version, definition);
    definitions.validateSources(
        prepared.definition(),
        resolver,
        (sourceId, sourceVersion) -> {
          deadline.check();
          var source = sourceSession.definition(sourceId, sourceVersion);
          deadline.check();
          return source;
        });
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
        id,
        version,
        result.result(),
        result.trace(),
        result.durationMicros(),
        result.sources(),
        result.traceEnabled(),
        result.traceTruncated(),
        result.executedSteps(),
        result.traceBytes(),
        new Timing(preparationMicros, result.durationMicros(), totalMicros));
  }

  private RuleResolver resolver(ExecutionDeadline deadline) {
    return new MemoizingRuleResolver(
        (id, version) -> {
          deadline.check();
          Definition definition = rules.resolve(id, version);
          deadline.check();
          return definition;
        });
  }

  private static ExecutionDeadline deadline(Integer timeoutMs) {
    return ExecutionDeadline.start(timeoutMs == null ? 30_000 : timeoutMs);
  }
}
