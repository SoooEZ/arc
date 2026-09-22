package dev.arc.engine.execution;

import dev.arc.engine.graph.GraphPlan;
import dev.arc.error.ArcException;
import java.util.*;

/**
 * Values retain their producing node so joins distinguish sequential updates from sibling writes.
 */
final class ExecutionScope {
  private record ProducedValue(Object value, String origin) {}

  private final Map<String, ProducedValue> values = new LinkedHashMap<>();

  static ExecutionScope inputs(Map<String, Object> inputs, String inputNode) {
    var scope = new ExecutionScope();
    inputs.forEach((name, value) -> scope.store(name, value, inputNode));
    return scope;
  }

  static ExecutionScope merge(List<ExecutionScope> parents, GraphPlan plan) {
    Map<String, Map<String, ProducedValue>> candidates = new LinkedHashMap<>();
    for (ExecutionScope parent : parents) {
      for (var entry : parent.values.entrySet()) {
        ProducedValue value = entry.getValue();
        candidates
            .computeIfAbsent(entry.getKey(), ignored -> new LinkedHashMap<>())
            .put(value.origin(), value);
      }
    }
    var merged = new ExecutionScope();
    for (var entry : candidates.entrySet()) {
      merged.values.put(entry.getKey(), latestValue(entry.getKey(), entry.getValue(), plan));
    }
    return merged;
  }

  private static ProducedValue latestValue(
      String name, Map<String, ProducedValue> candidates, GraphPlan plan) {
    ProducedValue latest = null;
    for (ProducedValue candidate : candidates.values()) {
      boolean superseded = false;
      for (String otherOrigin : candidates.keySet()) {
        if (plan.isAncestor(candidate.origin(), otherOrigin)) {
          superseded = true;
          break;
        }
      }
      if (superseded) continue;
      if (latest != null) throw conflict(name);
      latest = candidate;
    }
    if (latest == null) throw conflict(name);
    return latest;
  }

  private static ArcException conflict(String name) {
    return ArcException.invalid(
        "Conflicting upstream values for '"
            + name
            + "'; use distinct result variable names before merging");
  }

  void store(String name, Object value, String origin) {
    values.put(name, new ProducedValue(value, origin));
  }

  Map<String, Object> variables() {
    Map<String, Object> scope = new LinkedHashMap<>();
    values.forEach((name, value) -> scope.put(name, value.value()));
    return scope;
  }
}
