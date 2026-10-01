package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.SourceReader;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import java.util.*;
import java.util.function.Supplier;
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
      @JsonSerialize(using = RetainedTrace.Serializer.class) List<Step> trace,
      long durationMicros,
      List<Parameters.Read> sources,
      boolean traceEnabled,
      boolean traceTruncated,
      int executedSteps,
      int traceBytes) {}

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
    this.plans = new ExecutionPlans(validator, json);
    this.json = json;
    this.traceMaximumBytes = traceMaximumBytes;
  }

  public Session session(RuleResolver resolver, ExecutionDeadline deadline) {
    return new Session(resolver, deadline, true);
  }

  /**
   * The plan of a published version for a static check of a pinned callee (validate, diagnostics,
   * publish): the plan an execution cached, else one compiled for this check only. A check may read
   * versions that its transaction has not committed, such as the samples the seed publishes in one
   * transaction and rolls back when an ID is taken, so only executions fill the cache. A check has
   * no deadline.
   */
  public CompiledGraph prepareForCheck(
      String id, int version, Definition definition, RuleResolver resolver) {
    return plans.planForCheck(id, version, definition, resolver);
  }

  /** Drops the cached plans of a deleted rule. Call it after the deletion commits. */
  public void forget(String ruleId) {
    plans.forget(ruleId);
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

    /**
     * Compiles a draft (null version) or a pinned version once per session. A pinned definition is
     * read only if the process plan cache does not hold that version already.
     */
    public CompiledGraph prepare(String id, Integer version, Supplier<Definition> definition) {
      return prepared.prepare(id, version, definition);
    }

    /**
     * Runs {@code check}, such as the source-contract walk of a prepared root, unless it already
     * passed for this published version's cached plan; a draft (null version) is always checked.
     */
    public void verifyOnce(String id, Integer version, Runnable check) {
      prepared.verifyOnce(id, version, check);
    }

    /** Runs a rule with this session's plans, which its nested calls share. */
    public Result execute(
        String id,
        Integer version,
        Supplier<Definition> definition,
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
    var session =
        new Session(resolver, ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS), false);
    return session.execute(ruleId, version, () -> definition, inputs, parameters, true);
  }
}
