package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.SourceReader;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
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
      Object result,
      List<Step> trace,
      long durationMicros,
      List<Parameters.Read> sources,
      boolean traceEnabled,
      boolean traceTruncated,
      int executedSteps,
      int traceBytes) {
    public Result(
        Object result, List<Step> trace, long durationMicros, List<Parameters.Read> sources) {
      this(result, trace, durationMicros, sources, true, false, trace.size(), 0);
    }
  }

  private final ExecutionPlans plans;
  private final ObjectMapper json;
  private final int traceMaximumBytes;

  public Engine(Validator validator) {
    this(validator, new ObjectMapper());
  }

  @Autowired
  public Engine(Validator validator, ObjectMapper json) {
    this(validator, json, 256 * 1024);
  }

  Engine(Validator validator, ObjectMapper json, int traceMaximumBytes) {
    this.plans = new ExecutionPlans(validator);
    this.json = json;
    this.traceMaximumBytes = traceMaximumBytes;
  }

  public Session session(RuleResolver resolver, ExecutionDeadline deadline) {
    return new Session(resolver, deadline, true);
  }

  public final class Session {
    private final RuleResolver resolver;
    private final ExecutionDeadline deadline;
    private final ExecutionPlans.Session prepared;

    private Session(RuleResolver resolver, ExecutionDeadline deadline, boolean cachePublished) {
      this.resolver = resolver;
      this.deadline = deadline;
      this.prepared = plans.session(resolver, deadline, cachePublished);
    }

    public CompiledGraph prepare(String id, Integer version, Definition definition) {
      return prepared.prepare(id, version, definition);
    }

    public Result execute(
        String id,
        Integer version,
        Definition definition,
        Map<String, Object> inputs,
        Parameters parameters,
        boolean traceEnabled) {
      long start = System.nanoTime();
      var trace = new ExecutionTrace(json, traceEnabled, traceMaximumBytes);
      var execution = new GraphExecution(prepared, resolver, parameters, deadline, trace);
      Object value = execution.run(id, version, definition, inputs, 0);
      deadline.check();
      return new Result(
          value,
          trace.steps(),
          (System.nanoTime() - start) / 1000,
          parameters.reads(),
          trace.enabled(),
          trace.truncated(),
          execution.executedSteps(),
          trace.bytes());
    }
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
    // Embedded callers may provide changing definitions under the same ID/version.
    var session = new Session(resolver, ExecutionDeadline.start(30_000), false);
    return session.execute(ruleId, version, definition, inputs, parameters, true);
  }
}
