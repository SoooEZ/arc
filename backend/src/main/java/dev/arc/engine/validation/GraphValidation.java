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
    checkInputCycles(definition, inputReads, GraphValidation::fail);
    checkConnections(definition, GraphValidation::fail);
    var plan = new GraphPlan(definition);
    checkReachability(definition, plan, GraphValidation::fail);
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
   * Structure problems in the order validation finds them: the first input cycle, then every
   * connection problem and, with a scope plan, every unreachable node, each reported through {@code
   * problems}. A missing or second Input node stops the check, because the connection and
   * reachability rules need exactly one.
   */
  void checkStructure(
      Definition definition,
      Map<String, Set<String>> inputReads,
      GraphPlan plan,
      Consumer<ArcException> problems) {
    checkInputCycles(definition, inputReads, problems);
    checkConnections(definition, problems);
    if (plan != null) checkReachability(definition, plan, problems);
  }

  /** Reports the first input whose source mappings read it back, like every structure problem. */
  private void checkInputCycles(
      Definition definition, Map<String, Set<String>> inputReads, Consumer<ArcException> problems) {
    var finished = new HashSet<String>();
    for (Input input : definition.inputs()) {
      String cyclic = cyclicInput(input.name(), definition, inputReads, finished, new HashSet<>());
      if (cyclic != null) {
        problems.accept(ArcException.invalid("Circular source parameter dependency: " + cyclic));
        return;
      }
    }
  }

  /**
   * Depth-first over declared inputs in declaration order, so the reported input is stable. Returns
   * the input a mapping reads while that input is still being resolved, or null without a cycle.
   */
  private String cyclicInput(
      String name,
      Definition definition,
      Map<String, Set<String>> inputReads,
      Set<String> finished,
      Set<String> active) {
    if (active.contains(name)) return name;
    if (finished.contains(name)) return null;
    active.add(name);
    var reads = inputReads.getOrDefault(name, Set.of());
    for (Input input : definition.inputs()) {
      if (!reads.contains(input.name())) continue;
      String cyclic = cyclicInput(input.name(), definition, inputReads, finished, active);
      if (cyclic != null) return cyclic;
    }
    active.remove(name);
    finished.add(name);
    return null;
  }

  private void checkConnections(Definition definition, Consumer<ArcException> problems) {
    var nodeIndex = definition.nodes().stream().collect(Collectors.toMap(Node::id, node -> node));
    List<Node> inputs = definition.nodesOf(NodeKind.INPUT);
    require(inputs.size() == 1, "A rule must have exactly one Input node");
    Node input = inputs.getFirst();
    Map<String, List<Edge>> outgoing = new HashMap<>(), incoming = new HashMap<>();
    for (Edge e : definition.edges()) {
      outgoing.computeIfAbsent(e.source(), k -> new ArrayList<>()).add(e);
      incoming.computeIfAbsent(e.target(), k -> new ArrayList<>()).add(e);
    }
    if (!incoming.getOrDefault(input.id(), List.of()).isEmpty())
      problems.accept(problem("Input node cannot have incoming connections", input));
    for (Node node : definition.nodes()) {
      List<Edge> edges = outgoing.getOrDefault(node.id(), List.of());
      List<String> expected = node.handles();
      if (expected.isEmpty()) {
        if (!edges.isEmpty())
          problems.accept(problem(node.label() + ": connect no outgoing branches", node));
        continue;
      }
      // An exit the node does not have is named: "connect [true, false]" read as a missing
      // connection when both were connected.
      var handles = new LinkedHashSet<String>();
      for (Edge edge : edges) handles.add(edge.sourceHandle());
      var stray = new ArrayList<>(handles);
      stray.removeAll(expected);
      if (!stray.isEmpty())
        problems.accept(
            problem(
                node.label()
                    + ": remove the connection from "
                    + String.join(", ", stray)
                    + ", which this node does not have",
                node));
      if (!handles.containsAll(expected))
        problems.accept(problem(node.label() + ": connect " + expected, node));
    }
    Set<String> connections = new HashSet<>();
    for (Edge e : definition.edges())
      if (!connections.add(e.source() + ":" + e.sourceHandle() + ":" + e.target()))
        problems.accept(problem("Duplicate connection", nodeIndex.get(e.source())));
  }

  /**
   * The scope plan already rejects cycles, so only nodes Input cannot reach remain to find. The
   * connection check has made sure that the graph has exactly one Input node.
   */
  private void checkReachability(
      Definition definition, GraphPlan plan, Consumer<ArcException> problems) {
    Node input = definition.inputNode().orElseThrow();
    Set<String> reached = new HashSet<>(Set.of(input.id()));
    Deque<String> pending = new ArrayDeque<>(reached);
    while (!pending.isEmpty())
      for (Edge edge : plan.outgoing(pending.pop()))
        if (reached.add(edge.target())) pending.push(edge.target());
    for (Node node : definition.nodes())
      if (!reached.contains(node.id()))
        problems.accept(
            problem(
                "Every node must be reachable from Input; connect or remove unused nodes", node));
  }

  private static void fail(ArcException error) {
    throw error;
  }

  private static ArcException problem(String message, Node node) {
    return ArcException.invalid(message).atNode(null, null, node.id(), node.label());
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
