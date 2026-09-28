package dev.arc.engine.execution;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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

  private record Entry(CompiledGraph plan, long weight) {}

  private final Validator validator;
  private final ObjectMapper json;
  private final int maximumEntries;
  private final long maximumWeight;
  private final Map<Pin, Entry> published = new LinkedHashMap<>(16, 0.75f, true);
  private long weight;

  /**
   * Advances whenever plans are forgotten. A session may have read a rule before its deletion, so
   * it caches plans only while the generation it started in lasts.
   */
  private long generation;

  ExecutionPlans(Validator validator, ObjectMapper json) {
    this(validator, json, 128, 8 * 1024 * 1024);
  }

  ExecutionPlans(Validator validator, ObjectMapper json, int maximumEntries, long maximumWeight) {
    this.validator = validator;
    this.json = json;
    this.maximumEntries = maximumEntries;
    this.maximumWeight = maximumWeight;
  }

  Session session(RuleResolver resolver, ExecutionDeadline deadline, boolean cachePublished) {
    return new Session(resolver, deadline, cachePublished);
  }

  private synchronized CompiledGraph cached(Pin pin) {
    Entry entry = published.get(pin);
    return entry == null ? null : entry.plan();
  }

  /**
   * Drops every cached plan of a deleted rule, so its ID can later name a different rule. Call it
   * after the deletion commits: a session that starts earlier can still read the rule.
   */
  synchronized void forget(String ruleId) {
    generation++;
    var entries = published.entrySet().iterator();
    while (entries.hasNext()) {
      var entry = entries.next();
      if (!entry.getKey().id().equals(ruleId)) continue;
      weight -= entry.getValue().weight();
      entries.remove();
    }
  }

  private synchronized long currentGeneration() {
    return generation;
  }

  private void remember(Pin pin, CompiledGraph plan, long sessionGeneration) {
    store(pin, plan, weight(plan), sessionGeneration);
  }

  private synchronized void store(
      Pin pin, CompiledGraph plan, long planWeight, long sessionGeneration) {
    if (sessionGeneration != generation) return;
    if (maximumEntries <= 0 || planWeight > maximumWeight) return;
    Entry previous = published.put(pin, new Entry(plan, planWeight));
    weight += planWeight - (previous == null ? 0 : previous.weight());
    while (published.size() > maximumEntries || weight > maximumWeight) {
      var iterator = published.entrySet().iterator();
      Entry removed = iterator.next().getValue();
      iterator.remove();
      weight -= removed.weight();
    }
  }

  final class Session {
    private final RuleResolver resolver;
    private final ExecutionDeadline deadline;
    private final boolean cachePublished;
    private final Map<Pin, CompiledGraph> pins = new HashMap<>();
    private final Map<Definition, CompiledGraph> drafts = new IdentityHashMap<>();
    private final long startedIn = currentGeneration();

    private Session(RuleResolver resolver, ExecutionDeadline deadline, boolean cachePublished) {
      this.resolver = resolver;
      this.deadline = deadline;
      this.cachePublished = cachePublished;
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
      if (plan == null && cachePublished) plan = cached(pin);
      if (plan == null) {
        plan = compile(definition.get());
        if (cachePublished) remember(pin, plan, startedIn);
      }
      pins.put(pin, plan);
      return plan;
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
   * cost per node and connection, each compiled expression by its source length, and one unit per
   * byte of the definition's JSON, which covers every field without listing them here.
   */
  private long weight(CompiledGraph plan) {
    Definition definition = plan.definition();
    long weight = 1024L + definition.nodes().size() * 2048L + definition.edges().size() * 128L;
    for (String source : plan.expressions().keySet()) weight += (40L + source.length() * 2L) * 32;
    try {
      return weight + json.writeValueAsBytes(definition).length;
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Cannot measure a compiled definition", failure);
    }
  }
}
