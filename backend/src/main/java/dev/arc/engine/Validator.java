package dev.arc.engine;

import dev.arc.api.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class Validator {
  private static final Set<String> TYPES =
      Set.of("INPUT", "FORMULA", "CONDITION", "REFERENCE", "OUTPUT");

  public static boolean identifier(String s) {
    return s != null
        && s.matches("[A-Za-z_][A-Za-z_0-9]{0,63}")
        && !Set.of("true", "false", "null", "and", "or").contains(s.toLowerCase(Locale.ROOT));
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }

  /** Drafts can be incomplete, but always enforce size limits and structural shape. */
  public void shape(Definition d) {
    require(d != null, "Definition is required");
    require(d.schemaVersion() == 1, "Only schemaVersion 1 is supported");
    require(d.inputs() != null && d.inputs().size() <= 50, "Provide at most 50 inputs");
    require(
        d.nodes() != null && !d.nodes().isEmpty() && d.nodes().size() <= 100,
        "Provide 1 to 100 nodes");
    require(d.edges() != null && d.edges().size() <= 200, "Provide at most 200 edges");
    require(
        d.notes() == null
            || d.notes().size() <= 500
                && d.notes().stream().allMatch(n -> n != null && n.length() <= 2000),
        "Too many or oversized comments");
    Set<String> ids = new HashSet<>();
    for (Node n : d.nodes()) {
      require(
          n != null && n.id() != null && n.id().matches("[A-Za-z0-9_-]{1,80}"),
          "Every node needs a valid ID");
      require(
          n.position() == null
              || Double.isFinite(n.position().x())
                  && Double.isFinite(n.position().y())
                  && Math.abs(n.position().x()) <= 1_000_000
                  && Math.abs(n.position().y()) <= 1_000_000,
          "Node position must be finite and within canvas bounds");
      require(ids.add(n.id()), "Duplicate node ID: " + n.id());
      require(TYPES.contains(n.type() == null ? "" : n.type()), "Unknown node type: " + n.type());
      require(
          n.label() != null && !n.label().isBlank() && n.label().length() <= 160,
          "Every node needs a label of 1 to 160 characters");
      require(
          n.expression() == null || n.expression().length() <= 2000,
          "Expression exceeds 2,000 characters");
      require(
          n.bindings() == null || n.bindings().size() <= 50,
          "Provide at most 50 parameter bindings");
      if (n.bindings() != null)
        for (var binding : n.bindings().entrySet()) {
          require(
              identifier(binding.getKey())
                  && binding.getValue() != null
                  && binding.getValue().length() <= 2000,
              "Invalid parameter binding");
        }
    }
    Set<String> edgeIds = new HashSet<>();
    for (Edge e : d.edges()) {
      require(
          e != null && e.id() != null && e.id().length() <= 100 && edgeIds.add(e.id()),
          "Every connection needs a unique ID");
      require(
          ids.contains(e.source()) && ids.contains(e.target()),
          "Connection refers to a missing node");
      require(
          Set.of("next", "true", "false")
              .contains(e.sourceHandle() == null ? "" : e.sourceHandle()),
          "Invalid connection handle");
    }
    Set<String> names = new HashSet<>();
    for (Input p : d.inputs()) {
      require(
          p != null && identifier(p.name()),
          "Input names must be identifiers (letters, digits, underscores)");
      require(names.add(p.name()), "Duplicate input: " + p.name());
      require(
          Set.of("NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT")
              .contains(p.type() == null ? "" : p.type()),
          "Unknown input type");
      if (p.defaultValue() != null) checkType(p.name(), p.type(), p.defaultValue());
      if (p.source() != null) {
        var b = p.source();
        require(
            b.id() != null && b.id().matches("[a-z][a-z0-9-]{0,79}") && b.version() > 0,
            "Source needs an ID and version");
        require(
            b.bindings() != null && b.bindings().size() <= 20, "Source needs up to 20 mappings");
        for (var e : b.bindings().entrySet())
          require(
              identifier(e.getKey()) && e.getValue() != null && e.getValue().length() <= 2000,
              "Invalid source mapping");
        require(
            b.pointer() == null
                || b.pointer().isEmpty()
                || b.pointer().startsWith("/") && b.pointer().length() <= 500,
            "Use a JSON pointer starting with /");
        require(
            Set.of("FAIL", "DEFAULT").contains(b.onError() == null ? "" : b.onError()),
            "Choose FAIL or DEFAULT source error policy");
        require(
            !"DEFAULT".equals(b.onError()) || p.defaultValue() != null,
            "Source fallback requires a default value");
      }
    }
  }

  public void validate(Definition d, RuleResolver resolver) {
    shape(d);
    var inputNames = d.inputs().stream().map(Input::name).collect(Collectors.toSet());
    Map<String, Set<String>> dependencies = new HashMap<>();
    for (Input p : d.inputs()) {
      var deps = new HashSet<String>();
      if (p.source() != null)
        for (String expr : p.source().bindings().values()) {
          expression(expr, inputNames, p.name() + " source");
          deps.addAll(Expressions.compile(expr).variables());
        }
      dependencies.put(p.name(), deps);
    }
    for (String name : inputNames)
      inputCycles(name, dependencies, new HashSet<>(), new HashSet<>());
    var nodes = d.nodes().stream().collect(Collectors.toMap(Node::id, n -> n));
    var starts = d.nodes().stream().filter(n -> n.type().equals("INPUT")).toList();
    require(starts.size() == 1, "A rule must have exactly one Input node");
    Map<String, List<Edge>> outgoing = new HashMap<>(), incoming = new HashMap<>();
    for (Edge e : d.edges()) {
      outgoing.computeIfAbsent(e.source(), k -> new ArrayList<>()).add(e);
      incoming.computeIfAbsent(e.target(), k -> new ArrayList<>()).add(e);
    }
    require(
        incoming.getOrDefault(starts.getFirst().id(), List.of()).isEmpty(),
        "Input node cannot have incoming connections");
    for (Node n : d.nodes()) {
      List<Edge> edges = outgoing.getOrDefault(n.id(), List.of());
      Set<String> handles = edges.stream().map(Edge::sourceHandle).collect(Collectors.toSet());
      Set<String> expected =
          n.type().equals("CONDITION")
              ? Set.of("true", "false")
              : n.type().equals("OUTPUT") ? Set.of() : Set.of("next");
      require(
          edges.size() == expected.size() && handles.equals(expected),
          n.label() + ": connect " + (expected.isEmpty() ? "no outgoing branches" : expected));
    }
    Set<String> visited = new HashSet<>(), active = new HashSet<>();
    walk(starts.getFirst().id(), outgoing, visited, active);
    require(
        visited.size() == nodes.size(),
        "Every node must be reachable from Input; connect or remove unused nodes");
    // Topological data-flow analysis: a variable must exist on EVERY path into a node.
    Map<String, Set<String>> scopes = new HashMap<>();
    Map<String, Integer> remaining = new HashMap<>();
    incoming.forEach((id, es) -> remaining.put(id, es.size()));
    Queue<String> queue = new ArrayDeque<>();
    queue.add(starts.getFirst().id());
    while (!queue.isEmpty()) {
      String id = queue.remove();
      Node n = nodes.get(id);
      Set<String> scope = new HashSet<>();
      List<Edge> parents = incoming.getOrDefault(id, List.of());
      if (parents.isEmpty()) d.inputs().forEach(p -> scope.add(p.name()));
      else {
        scope.addAll(scopes.get(parents.getFirst().source()));
        for (Edge e : parents) scope.retainAll(scopes.get(e.source()));
      }
      if (Set.of("FORMULA", "CONDITION", "OUTPUT").contains(n.type()))
        expression(n.expression(), scope, n.label());
      if (n.type().equals("REFERENCE")) {
        require(
            n.ruleId() != null && n.version() != null && n.version() > 0,
            n.label() + ": select a published rule and version");
        Definition child = resolver.resolve(n.ruleId(), n.version());
        Map<String, String> bindings = n.bindings() == null ? Map.of() : n.bindings();
        Set<String> childNames =
            child.inputs().stream().map(Input::name).collect(Collectors.toSet());
        for (Input p : child.inputs())
          require(
              !p.required()
                  || p.defaultValue() != null
                  || p.source() != null
                  || bindings.containsKey(p.name()),
              n.label() + ": missing binding for " + p.name());
        for (var entry : bindings.entrySet()) {
          require(
              childNames.contains(entry.getKey()),
              n.label() + ": unknown parameter " + entry.getKey());
          expression(entry.getValue(), scope, n.label() + " / " + entry.getKey());
        }
      }
      if (n.type().equals("FORMULA") || n.type().equals("REFERENCE")) {
        require(identifier(n.output()), n.label() + ": provide a valid result variable");
        require(
            d.inputs().stream().noneMatch(p -> p.name().equals(n.output())),
            n.label() + ": cannot overwrite input " + n.output());
        scope.add(n.output());
      }
      scopes.put(id, scope);
      for (Edge e : outgoing.getOrDefault(id, List.of()))
        if (remaining.merge(e.target(), -1, Integer::sum) == 0) queue.add(e.target());
    }
  }

  private void inputCycles(
      String name, Map<String, Set<String>> deps, Set<String> seen, Set<String> active) {
    require(!active.contains(name), "Circular source parameter dependency: " + name);
    if (!seen.add(name)) return;
    active.add(name);
    for (String child : deps.getOrDefault(name, Set.of())) inputCycles(child, deps, seen, active);
    active.remove(name);
  }

  private void expression(String expression, Set<String> scope, String label) {
    try {
      var compiled = Expressions.compile(expression);
      var unknown = new TreeSet<>(compiled.variables());
      unknown.removeAll(scope);
      require(
          unknown.isEmpty(),
          "Variables unavailable on every incoming path: " + String.join(", ", unknown));
    } catch (ArcException e) {
      throw ArcException.invalid(label + ": " + e.getMessage());
    }
  }

  private void walk(
      String id, Map<String, List<Edge>> outgoing, Set<String> visited, Set<String> active) {
    require(!active.contains(id), "Decision trees cannot contain cycles");
    if (!visited.add(id)) return;
    active.add(id);
    for (Edge e : outgoing.getOrDefault(id, List.of())) walk(e.target(), outgoing, visited, active);
    active.remove(id);
  }

  public static Object checkType(String name, String type, Object value) {
    boolean valid =
        switch (type) {
          case "NUMBER" -> value instanceof Number;
          case "STRING" -> value instanceof String;
          case "BOOLEAN" -> value instanceof Boolean;
          case "ARRAY" -> value instanceof List<?>;
          case "OBJECT" -> value instanceof Map<?, ?>;
          default -> false;
        };
    require(valid, "Input '" + name + "' must be " + type.toLowerCase());
    return value instanceof Number ? Expressions.number(value) : Expressions.bounded(value);
  }
}
