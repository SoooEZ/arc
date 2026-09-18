package dev.arc.rule;

import dev.arc.engine.*;
import dev.arc.engine.Parameters;
import dev.arc.engine.SourceReader;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Coordinates one execution with request-scoped reference caching and source-read limits. */
@Service
public class RuleExecutionService {
  public record Execution(Map<String, Object> inputs, Integer version) {}

  public record Preview(Definition definition, Map<String, Object> inputs) {}

  public record ExecutionResponse(
      String ruleId,
      Integer version,
      Object result,
      List<Engine.Step> trace,
      long durationMicros,
      List<Parameters.Read> sources) {}

  private final RuleRepository rules;
  private final RuleDefinitionService definitions;
  private final Engine engine;
  private final SourceReader sources;

  public RuleExecutionService(
      RuleRepository rules,
      RuleDefinitionService definitions,
      Engine engine,
      SourceReader sources) {
    this.rules = rules;
    this.definitions = definitions;
    this.engine = engine;
    this.sources = sources;
  }

  public ExecutionResponse execute(String id, Execution request) {
    var rule = rules.get(id);
    Integer version = request.version() == null ? rule.publishedVersion() : request.version();
    if (version == null)
      throw new ArcException(409, "Publish this rule before calling its execution endpoint");
    var resolver = new MemoizingRuleResolver(rules);
    return evaluate(id, version, resolver.resolve(id, version), request.inputs(), resolver);
  }

  public ExecutionResponse preview(Preview request) {
    return evaluate(
        "preview", null, request.definition(), request.inputs(), new MemoizingRuleResolver(rules));
  }

  private ExecutionResponse evaluate(
      String id,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver) {
    definitions.validate(definition, resolver);
    var result = engine.execute(id, version, definition, inputs, resolver, new Parameters(sources));
    return new ExecutionResponse(
        id, version, result.result(), result.trace(), result.durationMicros(), result.sources());
  }
}
