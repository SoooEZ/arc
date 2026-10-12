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
 * The checks of an executable graph, in one order, reported through a sink: validation throws at
 * the first problem ({@link #compile}) and diagnostics collect every problem ({@link
 * GraphDiagnostics}), so the problem a publish or {@code /validate} names is the first one that
 * {@code /diagnostics} lists. The two used to order the same steps by hand and disagreed.
 */
final class GraphValidation {
  /**
   * What a pass produced: whether the draft shape let it run, the scope plan (null for a cyclic or
   * too complex graph) and the expressions it compiled.
   */
  record Pass(boolean shaped, GraphPlan plan, ExpressionCache expressions) {}

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
      Pass pass = check(definition, resolver, GraphValidation::fail);
      return new CompiledGraph(definition, pass.plan(), pass.expressions().compiled());
    } catch (ArcException error) {
      throw Problems.onInputNode(error, definition);
    }
  }

  /**
   * Runs every check in validation order and reports each problem to {@code problems}; a sink that
   * throws stops at the first. The order: the draft shape, which stops the pass; the source
   * mappings; input cycles; connections; the scope plan, whose cycle or complexity is a problem of
   * its own; reachability; then each node in execution order (document order without a plan) with
   * its expressions, pin and result name, followed by the joins where its writes always conflict.
   * Without a scope plan a node skips only its variable check.
   */
  Pass check(Definition definition, RuleResolver resolver, Consumer<ArcException> problems) {
    var violation = documentShape.firstViolation(definition);
    if (violation.isPresent()) {
      // Later checks assume a well-formed document.
      problems.accept(DefinitionShape.located(violation.get(), definition));
      return new Pass(false, null, null);
    }
    var expressions = new ExpressionCache();
    var inputReads = checkSourceMappings(definition, expressions, resolver, problems);
    checkInputCycles(definition, inputReads, problems);
    boolean oneInput = checkConnections(definition, problems);
    GraphPlan plan = scopePlan(definition, problems);
    if (oneInput && plan != null) checkReachability(definition, plan, problems);
    List<Node> nodes = plan == null ? definition.nodes() : plan.order();
    for (Node node : nodes) {
      Set<String> scope = plan == null ? null : plan.available().get(node.id());
      try {
        nodeValidation.validate(definition, node, scope, resolver, expressions);
      } catch (ArcException error) {
        problems.accept(error);
      }
      if (plan != null)
        for (GraphPlan.Conflict conflict : plan.conflicts(node.id()))
          problems.accept(conflictProblem(definition, node, conflict));
    }
    return new Pass(true, plan, expressions);
  }

  /** A cyclic or too complex graph has no scope plan; its nodes still get every other check. */
  private static GraphPlan scopePlan(Definition definition, Consumer<ArcException> problems) {
    try {
      return new GraphPlan(definition);
    } catch (ArcException error) {
      problems.accept(error);
      return null;
    }
  }

  /**
   * Checks every source mapping against the declared inputs and reports each problem at the Input
   * node. Returns, per input, the inputs its valid mappings read.
   */
  private Map<String, Set<String>> checkSourceMappings(
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

  /**
   * Reports every connection problem. A missing or second Input node is reported alone and ends the
   * check, because the connection and reachability rules need exactly one; the result says whether
   * the graph has it.
   */
  private boolean checkConnections(Definition definition, Consumer<ArcException> problems) {
    var nodeIndex = definition.nodes().stream().collect(Collectors.toMap(Node::id, node -> node));
    List<Node> inputs = definition.nodesOf(NodeKind.INPUT);
    if (inputs.size() != 1) {
      problems.accept(ArcException.invalid("A rule must have exactly one Input node"));
      return false;
    }
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
    return true;
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

  /**
   * Independent writers of one variable always meet at this join, so every execution would fail
   * there with the runtime's "Conflicting upstream values" ({@link GraphPlan.Conflict}). The
   * problem is located at the join first, then at each writer.
   */
  private static ArcException conflictProblem(
      Definition definition, Node join, GraphPlan.Conflict conflict) {
    var writers = new ArrayList<Node>();
    for (Node node : definition.nodes())
      if (conflict.writers().contains(node.id())) writers.add(node);
    writers.sort(Comparator.comparingInt(node -> conflict.writers().indexOf(node.id())));
    var labels = new ArrayList<String>();
    for (Node writer : writers) labels.add(writer.label());
    String named =
        String.join(", ", labels.subList(0, labels.size() - 1)) + " and " + labels.getLast();
    ArcException error =
        ArcException.invalid(
                "Conflicting upstream values for '"
                    + conflict.variable()
                    + "': "
                    + named
                    + (labels.size() == 2 ? " both" : " all")
                    + " set it on every path to "
                    + join.label()
                    + "; use distinct result variable names before merging")
            .atNode(null, null, join.id(), join.label());
    for (Node writer : writers) error = error.atNode(null, null, writer.id(), writer.label());
    return error;
  }

  private static void fail(ArcException error) {
    throw error;
  }

  private static ArcException problem(String message, Node node) {
    return ArcException.invalid(message).atNode(null, null, node.id(), node.label());
  }
}
