package dev.arc.engine.execution;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/** Bounded reusable plans for immutable pins; each request owns its resolver and local plan map. */
final class ExecutionPlans {
  private record Pin(String id, int version) {}

  private record Entry(CompiledGraph plan, long weight) {}

  private final Validator validator;
  private final int maximumEntries;
  private final long maximumWeight;
  private final Map<Pin, Entry> published = new LinkedHashMap<>(16, 0.75f, true);
  private long weight;

  ExecutionPlans(Validator validator) {
    this(validator, 128, 8 * 1024 * 1024);
  }

  ExecutionPlans(Validator validator, int maximumEntries, long maximumWeight) {
    this.validator = validator;
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

  private synchronized void remember(Pin pin, CompiledGraph plan) {
    long planWeight = weight(plan.definition());
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

    private Session(RuleResolver resolver, ExecutionDeadline deadline, boolean cachePublished) {
      this.resolver = resolver;
      this.deadline = deadline;
      this.cachePublished = cachePublished;
    }

    CompiledGraph prepare(String id, Integer version, Definition definition) {
      deadline.check();
      Pin pin = version == null ? null : new Pin(id, version);
      CompiledGraph plan = pin == null ? drafts.get(definition) : pins.get(pin);
      if (plan == null && pin != null && cachePublished) plan = cached(pin);
      if (plan == null) {
        // Detached immutable values prevent callers mutating a retained published definition.
        Definition snapshot = snapshot(definition);
        plan = validator.compile(snapshot, resolver);
        deadline.check();
        if (pin != null && cachePublished) remember(pin, plan);
      }
      if (pin == null) drafts.put(definition, plan);
      else pins.put(pin, plan);
      return plan;
    }
  }

  // Weight units estimate retained graph/AST/scope cost, not exact JVM heap bytes.
  private static long weight(Definition definition) {
    long weight = 1024L + definition.nodes().size() * 2048L + definition.edges().size() * 128L;
    for (Node node : definition.nodes()) {
      weight += text(node.expression()) * 32 + text(node.label()) + text(node.id());
      weight += text(node.selector()) * 32;
      if (node.bindings() != null)
        for (var entry : node.bindings().entrySet())
          weight += text(entry.getKey()) + text(entry.getValue()) * 32;
      if (node.cases() != null)
        for (BranchCase option : node.cases())
          weight += text(option.id()) + text(option.label()) + text(option.expression()) * 32;
      if (node.fields() != null)
        for (Field field : node.fields())
          weight += text(field.name()) + text(field.expression()) * 32;
    }
    for (Input input : definition.inputs()) {
      weight += valueWeight(input.defaultValue()) + text(input.name());
      if (input.source() != null)
        for (var entry : input.source().bindings().entrySet())
          weight += text(entry.getKey()) + text(entry.getValue()) * 32;
    }
    if (definition.notes() != null) for (String note : definition.notes()) weight += text(note);
    return weight;
  }

  private static long text(String text) {
    return text == null ? 0 : 40L + text.length() * 2L;
  }

  private static long valueWeight(Object value) {
    if (value instanceof String string) return text(string);
    if (value instanceof Map<?, ?> map) {
      long weight = 64;
      for (var entry : map.entrySet())
        weight += 64 + valueWeight(entry.getKey()) + valueWeight(entry.getValue());
      return weight;
    }
    if (value instanceof List<?> list) {
      long weight = 32;
      for (Object item : list) weight += 8 + valueWeight(item);
      return weight;
    }
    return 32;
  }

  private static Definition snapshot(Definition definition) {
    if (definition == null
        || definition.inputs() == null
        || definition.nodes() == null
        || definition.edges() == null)
      return definition; // Validator owns malformed-document diagnostics.
    var inputs = new ArrayList<Input>();
    for (Input input : definition.inputs()) {
      if (input == null) {
        inputs.add(null);
        continue;
      }
      SourceBinding source = input.source();
      if (source != null)
        source =
            new SourceBinding(
                source.id(),
                source.version(),
                copy(source.bindings()),
                source.pointer(),
                source.onError());
      inputs.add(
          new Input(
              input.name(), input.type(), input.required(), freeze(input.defaultValue()), source));
    }
    var nodes = new ArrayList<Node>();
    for (Node node : definition.nodes()) {
      if (node == null) {
        nodes.add(null);
        continue;
      }
      nodes.add(
          new Node(
              node.id(),
              node.type(),
              node.label(),
              node.position(),
              node.expression(),
              node.output(),
              node.ruleId(),
              node.version(),
              copy(node.bindings()),
              list(node.cases()),
              list(node.fields()),
              node.selector()));
    }
    return new Definition(
        definition.schemaVersion(),
        list(inputs),
        list(nodes),
        list(definition.edges()),
        list(definition.notes()));
  }

  private static <T> List<T> list(List<T> values) {
    return values == null ? null : Collections.unmodifiableList(new ArrayList<>(values));
  }

  private static <K, V> Map<K, V> copy(Map<K, V> values) {
    return values == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(values));
  }

  private static Object freeze(Object value) {
    return freeze(value, 0);
  }

  private static Object freeze(Object value, int depth) {
    if (depth > 8) return value; // The validator rejects this before a plan can be cached.
    if (value instanceof Map<?, ?> map) {
      var result = new LinkedHashMap<Object, Object>();
      map.forEach((key, item) -> result.put(key, freeze(item, depth + 1)));
      return Collections.unmodifiableMap(result);
    }
    if (value instanceof List<?> items) {
      var result = new ArrayList<Object>();
      for (Object item : items) result.add(freeze(item, depth + 1));
      return Collections.unmodifiableList(result);
    }
    return value;
  }
}
