package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Executable graph validation: input dependencies, connections, reachability and node scopes.
 * Diagnostics reuse the same steps to collect problems instead of stopping at the first.
 */
final class GraphValidation {
  private final DefinitionShape documentShape;
  private final NodeValidation nodeValidation;

  GraphValidation(DefinitionShape documentShape, NodeValidation nodeValidation) {
    this.documentShape = documentShape;
    this.nodeValidation = nodeValidation;
  }

  /**
   * Produces the checked topology and expressions that execution reuses; fails at the first
   * problem.
   */
  CompiledGraph compile(Definition definition, RuleResolver resolver) {
    try {
      return validateGraph(definition, resolver);
    } catch (ArcException error) {
      throw Problems.onInputNode(error, definition);
    }
  }

  private CompiledGraph validateGraph(Definition definition, RuleResolver resolver) {
    documentShape.validate(definition);
    var expressions = new ExpressionCache();
    var inputReads = checkSourceMappings(definition, expressions, resolver, GraphValidation::fail);
    checkInputCycles(definition, inputReads);
    checkConnections(definition);
    var plan = new GraphPlan(definition);
    checkReachability(definition, plan);
    for (Node node : plan.order()) {
      Set<String> scope = plan.available().get(node.id());
      nodeValidation.validate(definition, node, scope, resolver, expressions);
    }
    return new CompiledGraph(definition, plan, expressions.compiled());
  }

  /**
   * Checks every source mapping against the declared inputs and reports each problem at the Input
   * node. Returns, per input, the inputs its valid mappings read.
   */
  Map<String, Set<String>> checkSourceMappings(
      Definition definition,
      ExpressionCache expressions,
      RuleResolver resolver,
      Consumer<ArcException> problems) {
    var inputNames = definition.inputs().stream().map(Input::name).collect(Collectors.toSet());
    Map<String, Set<String>> inputReads = new HashMap<>();
    for (var input : NodeValidation.sourceMappings(definition).entrySet()) {
      var reads = new HashSet<String>();
      for (var mapping : input.getValue()) {
        try {
          reads.addAll(
              NodeValidation.check(mapping, inputNames, expressions, resolver).variables());
        } catch (ArcException error) {
          problems.accept(Problems.onInputNode(error, definition));
        }
      }
      inputReads.put(input.getKey(), reads);
    }
    return inputReads;
  }

  /**
   * The first input-cycle, connection or reachability problem, in the order validation finds it.
   */
  void checkStructure(Definition definition, Map<String, Set<String>> inputReads, GraphPlan plan) {
    checkInputCycles(definition, inputReads);
    checkConnections(definition);
    if (plan != null) checkReachability(definition, plan);
  }

  private void checkInputCycles(Definition definition, Map<String, Set<String>> inputReads) {
    var finished = new HashSet<String>();
    for (Input input : definition.inputs())
      visitInputReads(input.name(), definition, inputReads, finished, new HashSet<>());
  }

  /** Depth-first over declared inputs in declaration order, so the reported input is stable. */
  private void visitInputReads(
      String name,
      Definition definition,
      Map<String, Set<String>> inputReads,
      Set<String> finished,
      Set<String> active) {
    require(!active.contains(name), "Circular source parameter dependency: " + name);
    if (finished.contains(name)) return;
    active.add(name);
    var reads = inputReads.getOrDefault(name, Set.of());
    for (Input input : definition.inputs())
      if (reads.contains(input.name()))
        visitInputReads(input.name(), definition, inputReads, finished, active);
    active.remove(name);
    finished.add(name);
  }

  private void checkConnections(Definition definition) {
    var nodeIndex = definition.nodes().stream().collect(Collectors.toMap(Node::id, node -> node));
    List<Node> inputs = definition.nodesOf(NodeKind.INPUT);
    require(inputs.size() == 1, "A rule must have exactly one Input node");
    Node input = inputs.getFirst();
    Map<String, List<Edge>> outgoing = new HashMap<>(), incoming = new HashMap<>();
    for (Edge e : definition.edges()) {
      outgoing.computeIfAbsent(e.source(), k -> new ArrayList<>()).add(e);
      incoming.computeIfAbsent(e.target(), k -> new ArrayList<>()).add(e);
    }
    require(
        incoming.getOrDefault(input.id(), List.of()).isEmpty(),
        "Input node cannot have incoming connections");
    for (Node node : definition.nodes()) {
      List<Edge> edges = outgoing.getOrDefault(node.id(), List.of());
      Set<String> handles = edges.stream().map(Edge::sourceHandle).collect(Collectors.toSet());
      List<String> expected = node.handles();
      require(
          handles.equals(Set.copyOf(expected)),
          node.label() + ": connect " + (expected.isEmpty() ? "no outgoing branches" : expected),
          node);
    }
    Set<String> connections = new HashSet<>();
    for (Edge e : definition.edges())
      require(
          connections.add(e.source() + ":" + e.sourceHandle() + ":" + e.target()),
          "Duplicate connection",
          nodeIndex.get(e.source()));
  }

  /**
   * The scope plan already rejects cycles, so only nodes Input cannot reach remain to find. The
   * connection check has made sure that the graph has exactly one Input node.
   */
  private void checkReachability(Definition definition, GraphPlan plan) {
    Node input = definition.inputNode().orElseThrow();
    Set<String> reached = new HashSet<>(Set.of(input.id()));
    Deque<String> pending = new ArrayDeque<>(reached);
    while (!pending.isEmpty())
      for (Edge edge : plan.outgoing(pending.pop()))
        if (reached.add(edge.target())) pending.push(edge.target());
    for (Node node : definition.nodes())
      require(
          reached.contains(node.id()),
          "Every node must be reachable from Input; connect or remove unused nodes",
          node);
  }

  private static void fail(ArcException error) {
    throw error;
  }

  private void require(boolean condition, String message, Node node) {
    if (!condition) throw ArcException.invalid(message).atNode(null, null, node.id(), node.label());
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
