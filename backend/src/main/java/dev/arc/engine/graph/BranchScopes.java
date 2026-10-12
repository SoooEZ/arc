package dev.arc.engine.graph;

import dev.arc.engine.graph.GraphPlan.Conflict;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import java.util.*;

/**
 * Infers variables present whenever a node runs, without evaluating predicates, and the joins where
 * independent writes of one variable always meet.
 */
final class BranchScopes {
  /** What one analysis found: each node's guaranteed variables and the conflicts, in node order. */
  record Analysis(Map<String, Set<String>> available, List<Conflict> conflicts) {}

  /**
   * The scopes depend only on the graph, but the size of the decision diagram that computes them
   * depends on the order its tests are numbered, and no single order suits every graph: numbering
   * the branches with the most decisions below them first fits a ladder whose confirming check was
   * drawn before the next rung, and fails a "try the next tier" ladder whose fewest-first order
   * fits. Each order is tried in turn, and a graph is too complex only when none fits. Following
   * the connections as drawn comes last and keeps every graph that was valid before the other
   * orders were added.
   */
  Analysis analyze(Definition definition, GraphTopology topology) {
    BooleanConditions.TooComplex tooComplex = null;
    for (TargetOrder order : TargetOrder.values()) {
      try {
        return analyze(definition, topology, testOrder(definition, topology, order));
      } catch (BooleanConditions.TooComplex error) {
        tooComplex = error;
      }
    }
    throw tooComplex;
  }

  private static Analysis analyze(
      Definition definition, GraphTopology topology, List<Node> testOrder) {
    Map<String, Set<String>> available = new LinkedHashMap<>();
    var conflicts = new ArrayList<Conflict>();
    BooleanConditions logic = new BooleanConditions();
    Map<String, Integer> activation = new HashMap<>();
    Map<String, Map<String, Integer>> branchGates = new HashMap<>();
    // Each node's outgoing scope: for every variable, when each writer's value may be present. A
    // writer replaces every earlier write of its variable, as the execution scope does.
    Map<String, Map<String, Map<String, Integer>>> scopes = new HashMap<>();
    var paths = new Paths(topology);
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
      Map<String, Map<String, Integer>> scope = new HashMap<>();
      if (input) {
        for (Input parameter : definition.inputs())
          scope.put(parameter.name(), writtenBy(node.id(), 1));
      }
      for (Edge edge : topology.incoming(node.id())) {
        int gate = activation.get(edge.source());
        // A connection from an exit its node does not have is reported on that node; its target
        // keeps the node's scope rather than reporting variables unavailable on a path never taken.
        Integer exit = branchGates.getOrDefault(edge.source(), Map.of()).get(edge.sourceHandle());
        if (exit != null) gate = logic.and(gate, exit);
        active = logic.or(active, gate);
        for (var variable : scopes.get(edge.source()).entrySet()) {
          var writers = scope.computeIfAbsent(variable.getKey(), name -> new LinkedHashMap<>());
          for (var write : variable.getValue().entrySet())
            writers.merge(write.getKey(), logic.and(gate, write.getValue()), logic::or);
        }
      }
      Set<String> guaranteed = new TreeSet<>();
      if (active != 0) {
        for (var variable : new TreeMap<>(scope).entrySet()) {
          int present = 0;
          for (int write : variable.getValue().values()) present = logic.or(present, write);
          if (logic.and(active, logic.not(present)) == 0) guaranteed.add(variable.getKey());
          List<String> independent =
              independentWriters(variable.getValue(), active, logic, paths, topology);
          if (independent.size() > 1
              && !metUpstream(
                  node, variable.getKey(), independent, topology, activation, scopes, logic))
            conflicts.add(new Conflict(node.id(), variable.getKey(), independent));
        }
      }
      available.put(node.id(), Collections.unmodifiableSet(guaranteed));
      // An unfinished draft may store no result name yet; an empty one is unset as well.
      String result = node.resultName();
      if (node.storesResult() && result != null) scope.put(result, writtenBy(node.id(), active));
      activation.put(node.id(), active);
      scopes.put(node.id(), scope);
    }
    return new Analysis(Collections.unmodifiableMap(available), List.copyOf(conflicts));
  }

  private static Map<String, Integer> writtenBy(String writer, int when) {
    var writes = new LinkedHashMap<String, Integer>();
    writes.put(writer, when);
    return writes;
  }

  /**
   * The writers of one variable whose values are all present whenever the node runs and that no
   * path connects, in execution order; fewer than two when the graph alone does not decide a
   * conflict. A writer with a path to another always-present writer is left out: the later one
   * superseded its value when that path ran, which only the run can tell, so it is the later
   * writers that are known to meet. The check costs operations only where a variable has several
   * writers, so a graph the analysis accepted with one writer per variable fits as before.
   */
  private static List<String> independentWriters(
      Map<String, Integer> writes,
      int active,
      BooleanConditions logic,
      Paths paths,
      GraphTopology topology) {
    if (writes.size() < 2) return List.of();
    var always = new ArrayList<String>();
    for (var write : writes.entrySet())
      if (logic.and(active, logic.not(write.getValue())) == 0) always.add(write.getKey());
    var independent = new ArrayList<String>();
    for (String writer : always) {
      boolean followed = false;
      for (String other : always)
        if (!other.equals(writer) && paths.reaches(writer, other)) followed = true;
      if (!followed) independent.add(writer);
    }
    if (independent.size() < 2) return List.of();
    independent.sort(Comparator.comparingInt(topology::position));
    return List.copyOf(independent);
  }

  /**
   * Whether the writers already always meet at one of the node's parents: the conflict belongs to
   * the join where the values first meet, which reported it, and not to every node below it.
   */
  private static boolean metUpstream(
      Node node,
      String variable,
      List<String> writers,
      GraphTopology topology,
      Map<String, Integer> activation,
      Map<String, Map<String, Map<String, Integer>>> scopes,
      BooleanConditions logic) {
    for (Edge edge : topology.incoming(node.id())) {
      String parent = edge.source();
      Map<String, Integer> writes = scopes.get(parent).getOrDefault(variable, Map.of());
      int allPresent = 1;
      for (String writer : writers)
        allPresent = logic.and(allPresent, writes.getOrDefault(writer, 0));
      if (logic.and(activation.get(parent), logic.not(allPresent)) == 0) return true;
    }
    return false;
  }

  /** Whether one node can reach another along the connections, remembered per start node. */
  private static final class Paths {
    private final GraphTopology topology;
    private final Map<String, Set<String>> reachable = new HashMap<>();

    Paths(GraphTopology topology) {
      this.topology = topology;
    }

    boolean reaches(String from, String to) {
      return reachable.computeIfAbsent(from, this::reachableFrom).contains(to);
    }

    private Set<String> reachableFrom(String start) {
      var reached = new HashSet<String>();
      var pending = new ArrayDeque<String>(List.of(start));
      while (!pending.isEmpty())
        for (Edge edge : topology.outgoing(pending.pop()))
          if (reached.add(edge.target())) pending.push(edge.target());
      return reached;
    }
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
