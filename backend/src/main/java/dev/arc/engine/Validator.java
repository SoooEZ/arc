package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Graph validation facade: shape, topology/scope checks, and navigable editor diagnostics. */
@Component
public class Validator {
  private final DefinitionShape documentShape = new DefinitionShape();
  private final NodeValidation nodeValidation = new NodeValidation();

  public static boolean identifier(String name) {
    return InputValidation.identifier(name);
  }

  public static Object checkType(String name, String type, Object value) {
    return InputValidation.checkType(name, type, value);
  }

  /** Drafts may be incomplete; shape and size limits always apply. */
  public void shape(Definition definition) {
    documentShape.validate(definition);
  }

  public void validate(Definition definition, RuleResolver resolver) {
    try {
      validateGraph(definition, resolver);
    } catch (ArcException e) {
      if (!e.locations().isEmpty() || definition == null || definition.nodes() == null) throw e;
      Node input =
          definition.nodes().stream()
              .filter(node -> node != null && "INPUT".equals(node.type()))
              .findFirst()
              .orElse(null);
      throw input == null ? e : e.atNode(null, null, input.id(), input.label());
    }
  }

  private void validateGraph(Definition definition, RuleResolver resolver) {
    shape(definition);
    checkInputDependencies(definition);
    checkConnections(definition);
    var plan = new GraphPlan(definition);
    checkReachability(definition, plan);
    for (Node node : plan.order) {
      Set<String> scope = plan.available.get(node.id());
      nodeValidation.validate(definition, node, scope, resolver);
    }
  }

  private void checkInputDependencies(Definition definition) {
    var inputNames = definition.inputs().stream().map(Input::name).collect(Collectors.toSet());
    Map<String, Set<String>> dependencies = new HashMap<>();
    for (Input parameter : definition.inputs()) {
      var parameterDependencies = new HashSet<String>();
      if (parameter.source() != null)
        for (String expr : parameter.source().bindings().values()) {
          NodeValidation.expression(expr, inputNames, parameter.name() + " source");
          parameterDependencies.addAll(Expressions.compile(expr).variables());
        }
      dependencies.put(parameter.name(), parameterDependencies);
    }
    for (String name : inputNames)
      inputCycles(name, dependencies, new HashSet<>(), new HashSet<>());
  }

  private void checkConnections(Definition definition) {
    var nodeIndex = definition.nodes().stream().collect(Collectors.toMap(Node::id, node -> node));
    var starts = definition.nodes().stream().filter(node -> node.type().equals("INPUT")).toList();
    require(starts.size() == 1, "A rule must have exactly one Input node");
    Map<String, List<Edge>> outgoing = new HashMap<>(), incoming = new HashMap<>();
    for (Edge e : definition.edges()) {
      outgoing.computeIfAbsent(e.source(), k -> new ArrayList<>()).add(e);
      incoming.computeIfAbsent(e.target(), k -> new ArrayList<>()).add(e);
    }
    require(
        incoming.getOrDefault(starts.getFirst().id(), List.of()).isEmpty(),
        "Input node cannot have incoming connections");
    for (Node node : definition.nodes()) {
      List<Edge> edges = outgoing.getOrDefault(node.id(), List.of());
      Set<String> handles = edges.stream().map(Edge::sourceHandle).collect(Collectors.toSet());
      Set<String> expected = nodeValidation.handles(node);
      require(
          handles.equals(expected),
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

  private void checkReachability(Definition definition, GraphPlan plan) {
    Node input =
        definition.nodes().stream()
            .filter(node -> node.type().equals("INPUT"))
            .findFirst()
            .orElseThrow();
    Set<String> visited = new HashSet<>(), active = new HashSet<>();
    walk(input.id(), plan.outgoing, visited, active);
    for (Node node : definition.nodes())
      require(
          visited.contains(node.id()),
          "Every node must be reachable from Input; connect or remove unused nodes",
          node);
  }

  public record Problem(String message, List<ArcException.Location> locations) {
    public static Problem from(ArcException e) {
      return new Problem(e.getMessage(), e.locations());
    }
  }

  public List<Problem> diagnostics(Definition definition, RuleResolver resolver) {
    var problems = new LinkedHashSet<Problem>();
    try {
      shape(definition);
    } catch (ArcException e) {
      try {
        validate(definition, resolver);
      } catch (ArcException located) {
        problems.add(Problem.from(located));
      }
      return new ArrayList<>(problems);
    }
    Map<String, Set<String>> scope = null;
    try {
      scope = new GraphPlan(definition).available;
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    for (Node node : definition.nodes()) {
      try {
        if (scope != null)
          nodeValidation.validate(
              definition, node, scope.getOrDefault(node.id(), Set.of()), resolver);
        else nodeValidation.syntax(node);
      } catch (ArcException e) {
        problems.add(Problem.from(e.atNode(null, null, node.id(), node.label())));
      }
    }
    Node input =
        definition.nodes().stream()
            .filter(node -> node.type().equals("INPUT"))
            .findFirst()
            .orElse(null);
    var names = definition.inputs().stream().map(Input::name).collect(Collectors.toSet());
    for (Input parameter : definition.inputs())
      if (parameter.source() != null) {
        for (var binding : parameter.source().bindings().entrySet())
          try {
            NodeValidation.expression(
                binding.getValue(), names, parameter.name() + " source / " + binding.getKey());
          } catch (ArcException e) {
            problems.add(
                Problem.from(input == null ? e : e.atNode(null, null, input.id(), input.label())));
          }
      }
    try {
      validate(definition, resolver);
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    return new ArrayList<>(problems);
  }

  private void require(boolean condition, String message, Node node) {
    if (!condition) throw ArcException.invalid(message).atNode(null, null, node.id(), node.label());
  }

  private void inputCycles(
      String name, Map<String, Set<String>> deps, Set<String> seen, Set<String> active) {
    require(!active.contains(name), "Circular source parameter dependency: " + name);
    if (!seen.add(name)) return;
    active.add(name);
    for (String child : deps.getOrDefault(name, Set.of())) inputCycles(child, deps, seen, active);
    active.remove(name);
  }

  private void walk(
      String id, Map<String, List<Edge>> outgoing, Set<String> visited, Set<String> active) {
    require(!active.contains(id), "Decision trees cannot contain cycles");
    if (!visited.add(id)) return;
    active.add(id);
    for (Edge e : outgoing.getOrDefault(id, List.of())) walk(e.target(), outgoing, visited, active);
    active.remove(id);
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
