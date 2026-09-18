package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/** A deterministic DAG order and branch-sensitive variable availability. */
public final class GraphPlan {
  public final Map<String, Node> nodes = new LinkedHashMap<>();
  public final Map<String, List<Edge>> incoming = new HashMap<>(), outgoing = new HashMap<>();
  public final List<Node> order = new ArrayList<>();
  public final Map<String, Set<String>> ancestors = new HashMap<>(),
      available = new LinkedHashMap<>();

  public GraphPlan(Definition d) {
    for (Node n : d.nodes()) nodes.put(n.id(), n);
    for (Edge e : d.edges()) {
      incoming.computeIfAbsent(e.target(), k -> new ArrayList<>()).add(e);
      outgoing.computeIfAbsent(e.source(), k -> new ArrayList<>()).add(e);
    }
    Map<String, Integer> remaining = new HashMap<>();
    Queue<String> ready = new PriorityQueue<>();
    for (Node n : d.nodes()) {
      int count = incoming.getOrDefault(n.id(), List.of()).size();
      remaining.put(n.id(), count);
      if (count == 0) ready.add(n.id());
    }
    while (!ready.isEmpty()) {
      String id = ready.remove();
      order.add(nodes.get(id));
      Set<String> predecessors = new HashSet<>();
      for (Edge e : incoming.getOrDefault(id, List.of())) {
        predecessors.add(e.source());
        predecessors.addAll(ancestors.get(e.source()));
      }
      ancestors.put(id, predecessors);
      for (Edge e : outgoing.getOrDefault(id, List.of()))
        if (remaining.merge(e.target(), -1, Integer::sum) == 0) ready.add(e.target());
    }
    if (order.size() != nodes.size()) {
      Node n =
          nodes.values().stream().filter(x -> remaining.get(x.id()) > 0).findFirst().orElseThrow();
      throw ArcException.invalid("Decision graphs cannot contain cycles")
          .atNode(null, null, n.id(), n.label());
    }
    availability(d);
  }

  private void availability(Definition d) {
    Logic logic = new Logic();
    Map<String, Integer> activation = new HashMap<>(), predicates = new HashMap<>();
    Map<String, Map<String, Integer>> scopes = new HashMap<>();
    int index = 0;
    for (Node n : order)
      if (n.type().equals("CONDITION")) predicates.put(n.id(), logic.variable(index++));
    for (Node n : order) {
      int active = n.type().equals("INPUT") ? 1 : 0;
      Map<String, Integer> scope = new HashMap<>();
      if (n.type().equals("INPUT")) for (Input p : d.inputs()) scope.put(p.name(), 1);
      for (Edge edge : incoming.getOrDefault(n.id(), List.of())) {
        int gate = activation.get(edge.source());
        if (!edge.sourceHandle().equals("next") && predicates.containsKey(edge.source())) {
          int test = predicates.get(edge.source());
          gate = logic.and(gate, edge.sourceHandle().equals("true") ? test : logic.not(test));
        }
        active = logic.or(active, gate);
        for (var entry : scopes.get(edge.source()).entrySet()) {
          int present = logic.and(gate, entry.getValue());
          scope.merge(entry.getKey(), present, logic::or);
        }
      }
      Set<String> guaranteed = new TreeSet<>();
      if (active != 0)
        for (var entry : scope.entrySet())
          if (logic.and(active, logic.not(entry.getValue())) == 0) guaranteed.add(entry.getKey());
      available.put(n.id(), guaranteed);
      if ((n.type().equals("FORMULA") || n.type().equals("REFERENCE")) && n.output() != null)
        scope.put(n.output(), active);
      activation.put(n.id(), active);
      scopes.put(n.id(), scope);
    }
  }

  // Reduced ordered Boolean decision diagrams avoid enumerating every combination
  // of conditions. Each condition is independent: validation never assumes its value.
  private static final class Logic {
    record Branch(int variable, int low, int high) {}

    record Operation(boolean conjunction, int a, int b) {}

    final List<Branch> branches =
        new ArrayList<>(
            List.of(new Branch(Integer.MAX_VALUE, 0, 0), new Branch(Integer.MAX_VALUE, 1, 1)));
    final Map<Branch, Integer> unique = new HashMap<>();
    final Map<Operation, Integer> cache = new HashMap<>();
    final Map<Integer, Integer> inverses = new HashMap<>(Map.of(0, 1, 1, 0));

    int make(int variable, int low, int high) {
      if (low == high) return low;
      Branch b = new Branch(variable, low, high);
      Integer found = unique.get(b);
      if (found != null) return found;
      if (branches.size() >= 50_000)
        throw ArcException.invalid(
            "Branch analysis is too complex; split this graph into reusable rules");
      int id = branches.size();
      branches.add(b);
      unique.put(b, id);
      return id;
    }

    int variable(int index) {
      return make(index, 0, 1);
    }

    int not(int id) {
      Integer result = inverses.get(id);
      if (result != null) return result;
      Branch b = branches.get(id);
      int inverse = make(b.variable(), not(b.low()), not(b.high()));
      inverses.put(id, inverse);
      inverses.put(inverse, id);
      return inverse;
    }

    int and(int a, int b) {
      return apply(true, a, b);
    }

    int or(int a, int b) {
      return apply(false, a, b);
    }

    int apply(boolean conjunction, int a, int b) {
      if (a == b) return a;
      if (conjunction) {
        if (a == 0 || b == 0) return 0;
        if (a == 1) return b;
        if (b == 1) return a;
      } else {
        if (a == 1 || b == 1) return 1;
        if (a == 0) return b;
        if (b == 0) return a;
      }
      if (cache.size() > 200_000)
        throw ArcException.invalid(
            "Branch analysis is too complex; split this graph into reusable rules");
      Operation key = new Operation(conjunction, Math.min(a, b), Math.max(a, b));
      Integer found = cache.get(key);
      if (found != null) return found;
      Branch x = branches.get(a), y = branches.get(b);
      int top = Math.min(x.variable(), y.variable());
      int low =
          apply(conjunction, x.variable() == top ? x.low() : a, y.variable() == top ? y.low() : b);
      int high =
          apply(
              conjunction, x.variable() == top ? x.high() : a, y.variable() == top ? y.high() : b);
      int result = make(top, low, high);
      cache.put(key, result);
      return result;
    }
  }
}
