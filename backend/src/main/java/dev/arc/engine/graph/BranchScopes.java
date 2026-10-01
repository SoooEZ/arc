package dev.arc.engine.graph;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
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
    for (Node node : testOrder(definition, topology)) {
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
      // An unfinished draft may store no result name yet; an empty one is unset as well.
      String result = node.resultName();
      if (node.storesResult() && result != null) scope.put(result, active);
      activation.put(node.id(), active);
      scopes.put(node.id(), scope);
    }
    return Collections.unmodifiableMap(available);
  }

  /**
   * The branching nodes in the order their tests are numbered: a topological order that depends
   * neither on node IDs nor on the order connections were drawn, namely the reverse postorder of a
   * depth-first walk that starts at the Input node (then at any node it cannot reach, in document
   * order) and follows each node's handles in order. A child's test then stays next to its
   * parent's, which keeps the decision diagram of "any of these pairs passes" linear. Numbering
   * tests in the execution order, whose ties follow IDs, made the complexity cap depend on how
   * nodes were named: one graph passed as rule_01_a/rule_01_b and failed as check_01/confirm_01.
   * Following one handle's connections in document order then made it depend on drawing order: a
   * ladder whose true exit listed its confirming check before the next rung numbered every rung
   * before every confirmation and was too complex, while the other drawing order passed.
   */
  private static List<Node> testOrder(Definition definition, GraphTopology topology) {
    var walk = new DepthFirstWalk(definition, topology);
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

    DepthFirstWalk(Definition definition, GraphTopology topology) {
      for (Node node : definition.nodes()) nodes.put(node.id(), node);
      this.topology = topology;
    }

    /**
     * Walks each handle's targets with the most decisions below them first. The last target walked
     * finishes last, so it is numbered right after the node: a small side branch, such as the check
     * that confirms a rung, stays next to its parent while the rest of the graph is numbered after
     * it. Targets with as many decisions below them keep document order.
     */
    void visit(Node node) {
      if (!visited.add(node.id())) return;
      for (String handle : node.handles()) {
        var targets = new ArrayList<Node>();
        for (Edge edge : topology.outgoing(node.id()))
          if (handle.equals(edge.sourceHandle())) targets.add(nodes.get(edge.target()));
        targets.sort(Comparator.comparingInt(this::decisionsFrom).reversed());
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
