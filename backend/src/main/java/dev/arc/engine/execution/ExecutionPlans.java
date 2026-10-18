package dev.arc.engine.execution;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.BoundedCache;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import java.util.*;
import java.util.function.Supplier;

/**
 * Bounded reusable plans for immutable pins; each request owns its resolver and local plan map. A
 * pin stays immutable until its rule is deleted, which {@link #forget} handles.
 */
final class ExecutionPlans {
  private record Pin(String id, int version) {}

  /**
   * A cached plan, its weight, and whether its pinned contracts were checked ({@link
   * Session#verifyOnce}).
   */
  private record Cached(CompiledGraph plan, long weight, boolean verified) {}

  private final Validator validator;
  private final ObjectMapper json;
  private final BoundedCache<Pin, Cached> published;

  /**
   * Advances whenever plans are forgotten. A session may have read a rule before its deletion, so
   * it caches plans only while the generation it started in lasts.
   */
  private long generation;

  /**
   * Published plans kept at most: by count, and by their summed {@link #weight} (8 Mi estimated
   * weight units, not measured heap bytes).
   */
  private static final int MAXIMUM_PLANS = 128;

  private static final long MAXIMUM_PLAN_WEIGHT = 8 * 1024 * 1024;

  ExecutionPlans(Validator validator, ObjectMapper json) {
    this(validator, json, MAXIMUM_PLANS, MAXIMUM_PLAN_WEIGHT);
  }

  ExecutionPlans(Validator validator, ObjectMapper json, int maximumEntries, long maximumWeight) {
    this.validator = validator;
    this.json = json;
    this.published = new BoundedCache<>(maximumEntries, maximumWeight);
  }

  Session session(RuleResolver resolver, ExecutionDeadline deadline) {
    return new Session(resolver, deadline);
  }

  private Cached cached(Pin pin) {
    return published.get(pin);
  }

  /** See {@link Engine#prepareForCheck}: reads the cache and never stores. */
  CompiledGraph planForCheck(String id, int version, Definition definition, RuleResolver resolver) {
    CompiledGraph cached = cachedPlan(id, version);
    return cached != null ? cached : validator.compile(definition, resolver);
  }

  /**
   * See {@link Engine#check}: reads the cache, else compiles a detached copy and stores it, unless
   * a rule was forgotten since the check began ({@code startedIn}, the generation it captured
   * before its first read).
   */
  CompiledGraph planForCommittedCheck(
      String id, int version, Definition definition, RuleResolver resolver, long startedIn) {
    CompiledGraph cached = cachedPlan(id, version);
    if (cached != null) return cached;
    CompiledGraph plan = validator.compile(definition.detached(), resolver);
    remember(new Pin(id, version), plan, startedIn);
    return plan;
  }

  /** The plan an execution cached for a published version, or null. */
  CompiledGraph cachedPlan(String id, int version) {
    Cached entry = cached(new Pin(id, version));
    return entry == null ? null : entry.plan();
  }

  /**
   * Drops every cached plan of a deleted rule, so its ID can later name a different rule. Call it
   * after the deletion commits: a session that starts earlier can still read the rule.
   */
  synchronized void forget(String ruleId) {
    generation++;
    published.removeIf(pin -> pin.id().equals(ruleId));
  }

  /** The generation a session or a committed check captures before its first read. */
  synchronized long currentGeneration() {
    return generation;
  }

  private void remember(Pin pin, CompiledGraph plan, long sessionGeneration) {
    store(pin, new Cached(plan, weight(plan), false), sessionGeneration);
  }

  /** A verdict reached before a deletion is not stored after it, like a plan. */
  private synchronized void markVerified(Pin pin, long sessionGeneration) {
    Cached entry = published.get(pin);
    if (entry == null || entry.verified()) return;
    store(pin, new Cached(entry.plan(), entry.weight(), true), sessionGeneration);
  }

  /** A plan compiled before a deletion is not stored after it: the generation guards the store. */
  private synchronized void store(Pin pin, Cached entry, long sessionGeneration) {
    if (sessionGeneration != generation) return;
    published.put(pin, entry, entry.weight());
  }

  final class Session {
    private final RuleResolver resolver;
    private final ExecutionDeadline deadline;
    private final Map<Pin, CompiledGraph> pins = new HashMap<>();
    private final Map<Definition, CompiledGraph> drafts = new IdentityHashMap<>();
    private final long startedIn = currentGeneration();

    private Session(RuleResolver resolver, ExecutionDeadline deadline) {
      this.resolver = resolver;
      this.deadline = deadline;
    }

    /**
     * The compiled plan of a draft (no version) or of a pinned version. A draft is compiled once
     * per request. A pinned definition is read only when neither this request nor the published
     * plan cache has compiled that version yet.
     */
    CompiledGraph prepare(String id, Integer version, Supplier<Definition> definition) {
      deadline.check();
      if (version == null) return prepareDraft(definition.get());
      Pin pin = new Pin(id, version);
      CompiledGraph plan = pins.get(pin);
      if (plan == null) {
        Cached entry = cached(pin);
        if (entry != null) plan = entry.plan();
      }
      if (plan == null) {
        plan = compile(definition.get());
        remember(pin, plan, startedIn);
      }
      pins.put(pin, plan);
      return plan;
    }

    /**
     * Runs a check of a published version's pinned contracts once per cached plan. The version, the
     * pins it reaches and their source versions are immutable while it lives: a rule that another
     * rule calls cannot be deleted, and a deletion forgets the deleted rule's plans with their
     * verdicts. A draft (no version) and a failed check are checked again on the next request.
     */
    void verifyOnce(String id, Integer version, Runnable check) {
      Pin pin = version == null ? null : new Pin(id, version);
      Cached entry = pin == null ? null : cached(pin);
      if (entry != null && entry.verified()) return;
      check.run();
      if (pin != null) markVerified(pin, startedIn);
    }

    private CompiledGraph prepareDraft(Definition definition) {
      CompiledGraph plan = drafts.get(definition);
      if (plan == null) {
        plan = compile(definition);
        drafts.put(definition, plan);
      }
      return plan;
    }

    private CompiledGraph compile(Definition definition) {
      // A detached copy keeps a retained plan safe from later changes to the caller's definition.
      Definition detached = definition == null ? null : definition.detached();
      CompiledGraph plan = validator.compile(detached, resolver);
      deadline.check();
      return plan;
    }
  }

  /**
   * Weight units estimate the retained graph, AST and scope cost, not exact JVM heap bytes: a fixed
   * cost per node and connection, each compiled expression by its source length, each variable a
   * node's scope holds, and one unit per byte of the definition's JSON, which covers every field
   * without listing them here. Scopes grow with nodes times variables: 100 nodes with 50 inputs
   * hold 10,000 entries, which the per-node cost left uncounted.
   */
  private long weight(CompiledGraph plan) {
    Definition definition = plan.definition();
    long weight = 1024L + definition.nodes().size() * 2048L + definition.edges().size() * 128L;
    for (String source : plan.expressions().keySet()) weight += (40L + source.length() * 2L) * 32;
    for (Set<String> scope : plan.plan().available().values()) weight += 48L * scope.size();
    try {
      return weight + json.writeValueAsBytes(definition).length;
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Cannot measure a compiled definition", failure);
    }
  }
}
