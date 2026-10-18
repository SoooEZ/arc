package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
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

  /** The serialized trace a response carries at most (256 KiB); longer traces are truncated. */
  private static final int TRACE_MAXIMUM_BYTES = 256 * 1024;

  private final ExecutionPlans plans;
  private final ObjectMapper json;
  private final int traceMaximumBytes;

  @Autowired
  public Engine(Validator validator, ObjectMapper json) {
    this(validator, json, TRACE_MAXIMUM_BYTES);
  }

  Engine(Validator validator, ObjectMapper json, int traceMaximumBytes) {
    this.plans = new ExecutionPlans(validator, json);
    this.json = json;
    this.traceMaximumBytes = traceMaximumBytes;
  }

  public Session session(RuleResolver resolver, ExecutionDeadline deadline) {
    return new Session(resolver, deadline);
  }

  /**
   * The plan of a published version for a static check of a pinned callee inside a transaction
   * (publish, the sample seed): the plan an execution or an editor check cached, else one compiled
   * for this check only. Such a check may read versions that its transaction has not committed,
   * such as the samples the seed publishes in one transaction and rolls back when an ID is taken,
   * so it fills no cache (lesson B34). A check has no deadline.
   */
  public CompiledGraph prepareForCheck(
      String id, int version, Definition definition, RuleResolver resolver) {
    return plans.planForCheck(id, version, definition, resolver);
  }

  /**
   * A static check outside any transaction, such as the editor's validate and diagnostics: every
   * version it reads is committed, so the plans it compiles for the pins it reaches are kept, as an
   * execution's are, and the next check or execution of those pins reads nothing. Create it before
   * the first pin read: a plan compiled from a version read before a deletion is not stored after
   * it, as for an execution. {@code resolver} is the check's own, memoized resolver, which {@link
   * #cachedFirst} should back; it has no deadline.
   */
  public Check check(RuleResolver resolver) {
    return new Check(resolver);
  }

  /** See {@link #check}. */
  public final class Check {
    private final RuleResolver resolver;
    private final long startedIn;

    private Check(RuleResolver resolver) {
      this.resolver = resolver;
      this.startedIn = plans.currentGeneration();
    }

    public RuleResolver resolver() {
      return resolver;
    }

    /**
     * The plan of a reached pin: the cached one, else one compiled from a detached copy of the
     * stored definition and kept for later checks and executions.
     */
    public CompiledGraph prepare(String id, int version, Definition definition) {
      return plans.planForCommittedCheck(id, version, definition, resolver, startedIn);
    }
  }

  /**
   * Published definitions for a static check: a plan an execution or an editor check cached holds
   * the stored definition of its immutable version, so a reached pin is read and decoded from
   * {@code storage} only when no plan has it. Formula calls still ask storage, which also checks
   * the rule's kind.
   */
  public RuleResolver cachedFirst(RuleResolver storage) {
    return new RuleResolver() {
      @Override
      public Definition resolve(String id, int version) {
        CompiledGraph cached = plans.cachedPlan(id, version);
        return cached != null ? cached.definition() : storage.resolve(id, version);
      }

      @Override
      public Definition resolveFormula(String id, int version) {
        return storage.resolveFormula(id, version);
      }
    };
  }

  /** Drops the cached plans of a deleted rule. Call it after the deletion commits. */
  public void forget(String ruleId) {
    plans.forget(ruleId);
  }

  public final class Session {
    private final RuleResolver resolver;
    private final ExecutionDeadline deadline;
    private final ExecutionPlans.Session prepared;

    private Session(RuleResolver resolver, ExecutionDeadline deadline) {
      this.resolver = resolver;
      this.deadline = deadline;
      this.prepared = plans.session(resolver, deadline);
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
}
