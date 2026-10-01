package dev.arc.engine.graph;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import java.util.*;

/** Infers variables present whenever a node runs, without evaluating predicates. */
final class BranchScopes {
  /**
   * The scopes depend only on the graph, but the size of the decision diagram that computes them
   * depends on the order its tests are numbered, and no single order suits every graph: numbering
   * the branches with the most decisions below them first fits a ladder whose confirming check was
   * drawn before the next rung, and fails a "try the next tier" ladder whose fewest-first order
   * fits. Each order is tried in turn, and a graph is too complex only when none fits. Following
   * the connections as drawn comes last and keeps every graph that was valid before the other
   * orders were added.
   */
  Map<String, Set<String>> analyze(Definition definition, GraphTopology topology) {
    ArcException tooComplex = null;
    for (TargetOrder order : TargetOrder.values()) {
      try {
        return analyze(definition, topology, testOrder(definition, topology, order));
      } catch (ArcException error) {
        tooComplex = error;
      }
    }
    throw tooComplex;
  }

  private static Map<String, Set<String>> analyze(
      Definition definition, GraphTopology topology, List<Node> testOrder) {
    Map<String, Set<String>> available = new LinkedHashMap<>();
    BooleanConditions logic = new BooleanConditions();
    Map<String, Integer> activation = new HashMap<>();
    Map<String, Map<String, Integer>> branchGates = new HashMap<>();
    Map<String, Map<String, Integer>> scopes = new HashMap<>();
    int variableIndex = 0;
    for (Node node : testOrder) {
      // Each exit but the last has an independent test and is taken only when every earlier test
      // failed. The last exit, false or default, is taken when all of them fail.
      Map<String, Integer> gates = new HashMap<>();
      List<String> handles = node.handles();
      int remaining = 1;
      for (String handle : handles.subList(0, handles.size() - 1)) {
        int test = logic.variable(variableIndex++);
        gates.put(handle, logic.and(remaining, test));
        remaining = logic.and(remaining, logic.not(test));
      }
      gates.put(handles.getLast(), remaining);
      branchGates.put(node.id(), gates);
    }
    for (Node node : topology.order()) {
      boolean input = node.kind() == NodeKind.INPUT;
      int active = input ? 1 : 0;
      Map<String, Integer> scope = new HashMap<>();
      if (input) {
        for (Input parameter : definition.inputs()) scope.put(parameter.name(), 1);
      }
      for (Edge edge : topology.incoming(node.id())) {
        int gate = activation.get(edge.source());
        // A connection from an exit its node does not have is reported on that node; its target
        // keeps the node's scope rather than reporting variables unavailable on a path never taken.
        Integer exit = branchGates.getOrDefault(edge.source(), Map.of()).get(edge.sourceHandle());
        if (exit != null) gate = logic.and(gate, exit);
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
      // An unfinished draft may store no result name yet; an empty one is unset as well.
      String result = node.resultName();
      if (node.storesResult() && result != null) scope.put(result, active);
      activation.put(node.id(), active);
      scopes.put(node.id(), scope);
    }
    return Collections.unmodifiableMap(available);
  }

  /** Which of a handle's targets a test-numbering walk visits first. */
  private enum TargetOrder {
    MOST_DECISIONS_FIRST,
    FEWEST_DECISIONS_FIRST,
    /** The connections in the order they were drawn, the only order before 2026-10-01. */
    AS_DRAWN
  }

  /**
   * The branching nodes in the order their tests are numbered: the reverse postorder of a
   * depth-first walk that starts at the Input node (then at any node it cannot reach, in document
   * order) and follows each node's handles in order, visiting a handle's targets in the given
   * order. A child's test then stays next to its parent's, which keeps the decision diagram of "any
   * of these pairs passes" linear. The order never depends on node IDs: numbering tests in the
   * execution order, whose ties follow IDs, made one graph pass as rule_01_a/rule_01_b and fail as
   * check_01/confirm_01.
   */
  private static List<Node> testOrder(
      Definition definition, GraphTopology topology, TargetOrder targetOrder) {
    var walk = new DepthFirstWalk(definition, topology, targetOrder);
    for (Node node : definition.nodes()) if (node.kind() == NodeKind.INPUT) walk.visit(node);
    for (Node node : definition.nodes()) walk.visit(node);
    var order = new ArrayList<Node>();
    for (Node node : walk.reversePostorder()) if (node.kind().choosesOneExit()) order.add(node);
    return order;
  }

  private static final class DepthFirstWalk {
    private final Map<String, Node> nodes = new HashMap<>();
    private final GraphTopology topology;
    private final Set<String> visited = new HashSet<>();
    private final Map<String, Integer> decisions = new HashMap<>();

    /** Nodes in the order their walks finished, the last finished first. */
    private final Deque<Node> finished = new ArrayDeque<>();

    private final TargetOrder targetOrder;

    DepthFirstWalk(Definition definition, GraphTopology topology, TargetOrder targetOrder) {
      for (Node node : definition.nodes()) nodes.put(node.id(), node);
      this.topology = topology;
      this.targetOrder = targetOrder;
    }

    /**
     * Walks each handle's targets in the walk's order. The last target walked finishes last, so it
     * is numbered right after the node: with the most decisions below first, a small side branch,
     * such as the check that confirms a rung, stays next to its parent while the rest of the graph
     * is numbered after it. Targets with as many decisions below them keep the order they were
     * drawn in.
     */
    void visit(Node node) {
      if (!visited.add(node.id())) return;
      for (String handle : node.handles()) {
        var targets = new ArrayList<Node>();
        for (Edge edge : topology.outgoing(node.id()))
          if (handle.equals(edge.sourceHandle())) targets.add(nodes.get(edge.target()));
        switch (targetOrder) {
          case MOST_DECISIONS_FIRST ->
              targets.sort(Comparator.comparingInt(this::decisionsFrom).reversed());
          case FEWEST_DECISIONS_FIRST -> targets.sort(Comparator.comparingInt(this::decisionsFrom));
          case AS_DRAWN -> {}
        }
        for (Node target : targets) visit(target);
      }
      finished.push(node);
    }

    /** The branching nodes reachable from a node, the node itself included. */
    private int decisionsFrom(Node start) {
      Integer known = decisions.get(start.id());
      if (known != null) return known;
      var reached = new HashSet<String>();
      var pending = new ArrayDeque<String>(List.of(start.id()));
      int count = 0;
      while (!pending.isEmpty()) {
        String id = pending.pop();
        if (!reached.add(id)) continue;
        if (nodes.get(id).kind().choosesOneExit()) count++;
        for (Edge edge : topology.outgoing(id)) pending.push(edge.target());
      }
      decisions.put(start.id(), count);
      return count;
    }

    /** A topological order of the walked graph. */
    List<Node> reversePostorder() {
      return List.copyOf(finished);
    }
  }
}
