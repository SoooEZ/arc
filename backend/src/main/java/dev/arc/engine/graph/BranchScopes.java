package dev.arc.engine.graph;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/** Infers variables present whenever a node runs, without evaluating predicates. */
final class BranchScopes {
  Map<String, Set<String>> analyze(Definition definition, GraphTopology topology) {
    Map<String, Set<String>> available = new LinkedHashMap<>();
    BooleanConditions logic = new BooleanConditions();
    Map<String, Integer> activation = new HashMap<>();
    Map<String, Map<String, Integer>> branchGates = new HashMap<>();
    Map<String, Map<String, Integer>> scopes = new HashMap<>();
    int variableIndex = 0;
    for (Node node : topology.order()) {
      if (node.type().equals("CONDITION")) {
        int test = logic.variable(variableIndex++);
        branchGates.put(node.id(), Map.of("true", test, "false", logic.not(test)));
      } else if (node.type().equals("SWITCH")) {
        Map<String, Integer> gates = new HashMap<>();
        int remaining = 1;
        for (BranchCase option : node.cases() == null ? List.<BranchCase>of() : node.cases()) {
          int test = logic.variable(variableIndex++);
          gates.put("case:" + option.id(), logic.and(remaining, test));
          remaining = logic.and(remaining, logic.not(test));
        }
        gates.put("default", remaining);
        branchGates.put(node.id(), gates);
      }
    }
    for (Node node : topology.order()) {
      int active = node.type().equals("INPUT") ? 1 : 0;
      Map<String, Integer> scope = new HashMap<>();
      if (node.type().equals("INPUT")) {
        for (Input parameter : definition.inputs()) scope.put(parameter.name(), 1);
      }
      for (Edge edge : topology.incoming(node.id())) {
        int gate = activation.get(edge.source());
        if (branchGates.containsKey(edge.source())) {
          gate =
              logic.and(gate, branchGates.get(edge.source()).getOrDefault(edge.sourceHandle(), 0));
        }
        active = logic.or(active, gate);
        for (var entry : scopes.get(edge.source()).entrySet()) {
          int present = logic.and(gate, entry.getValue());
          scope.merge(entry.getKey(), present, logic::or);
        }
      }
      Set<String> guaranteed = new TreeSet<>();
      if (active != 0) {
        for (var entry : scope.entrySet()) {
          if (logic.and(active, logic.not(entry.getValue())) == 0) guaranteed.add(entry.getKey());
        }
      }
      available.put(node.id(), Collections.unmodifiableSet(guaranteed));
      if (node.storesResult() && node.output() != null) scope.put(node.output(), active);
      activation.put(node.id(), active);
      scopes.put(node.id(), scope);
    }
    return Collections.unmodifiableMap(available);
  }
}
