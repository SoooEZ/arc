package dev.arc.engine.execution;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.SourceReader;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class Engine {
  public record Step(
      String ruleId,
      Integer version,
      String nodeId,
      String label,
      String type,
      Object value,
      String branch,
      int depth) {}

  public record Result(
      Object result, List<Step> trace, long durationMicros, List<Parameters.Read> sources) {}

  private final Validator validator;

  public Engine(Validator validator) {
    this.validator = validator;
  }

  public Result execute(
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver) {
    return execute(
        ruleId, version, definition, inputs, resolver, new Parameters(SourceReader.unavailable()));
  }

  public Result execute(
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver,
      Parameters parameters) {
    long start = System.nanoTime();
    var execution = new GraphExecution(validator, resolver, parameters);
    Object value = execution.run(ruleId, version, definition, inputs, 0);
    return new Result(
        value, execution.trace(), (System.nanoTime() - start) / 1000, parameters.reads());
  }
}
