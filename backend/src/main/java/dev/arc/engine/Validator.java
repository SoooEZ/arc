package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class Validator {
  private static final Set<String> TYPES =
      Set.of("INPUT", "FORMULA", "CONDITION", "SWITCH", "TRANSFORM", "REFERENCE", "OUTPUT");

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
      try {
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
        require(n.cases() == null || n.type().equals("SWITCH"), "Cases belong to Switch nodes");
        require(
            n.fields() == null || n.type().equals("TRANSFORM"), "Fields belong to Transform nodes");
        if (n.cases() != null) {
          require(n.cases().size() <= 20, "Provide at most 20 cases");
          var caseIds = new HashSet<String>();
          for (BranchCase option : n.cases()) {
            require(
                option != null
                    && option.id() != null
                    && option.id().matches("[A-Za-z0-9_-]{1,64}")
                    && caseIds.add(option.id()),
                "Every case needs a unique, stable ID");
            require(
                option.label() != null
                    && !option.label().isBlank()
                    && option.label().length() <= 160,
                "Every case needs a label of 1 to 160 characters");
            require(
                option.expression() != null && option.expression().length() <= 2000,
                "Case expression exceeds 2,000 characters or is missing");
          }
        }
        if (n.fields() != null) {
          require(n.fields().size() <= 50, "Provide at most 50 transform fields");
          var fieldNames = new HashSet<String>();
          for (Field field : n.fields()) {
            require(
                field != null
                    && field.name() != null
                    && !field.name().isBlank()
                    && field.name().length() <= 160
                    && fieldNames.add(field.name()),
                "Transform fields need unique names of 1 to 160 characters");
            require(
                field.expression() != null && field.expression().length() <= 2000,
                "Field expression exceeds 2,000 characters or is missing");
          }
          require(
              n.fields().isEmpty() || n.expression() == null,
              "Transform uses either field mappings or one expression, not both");
        }
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
      } catch (ArcException e) {
        throw n == null ? e : e.atNode(null, null, n.id(), n.label());
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
          e.sourceHandle() != null
              && (Set.of("next", "true", "false", "default").contains(e.sourceHandle())
                  || e.sourceHandle().matches("case:[A-Za-z0-9_-]{1,64}")),
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
    try {
      validateGraph(d, resolver);
    } catch (ArcException e) {
      if (!e.locations().isEmpty() || d == null || d.nodes() == null) throw e;
      Node input =
          d.nodes().stream()
              .filter(n -> n != null && "INPUT".equals(n.type()))
              .findFirst()
              .orElse(null);
      throw input == null ? e : e.atNode(null, null, input.id(), input.label());
    }
  }

  private void validateGraph(Definition d, RuleResolver resolver) {
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
      Set<String> expected = handles(n);
      require(
          handles.equals(expected),
          n.label() + ": connect " + (expected.isEmpty() ? "no outgoing branches" : expected),
          n);
    }
    Set<String> connections = new HashSet<>();
    for (Edge e : d.edges())
      require(
          connections.add(e.source() + ":" + e.sourceHandle() + ":" + e.target()),
          "Duplicate connection",
          nodes.get(e.source()));
    var plan = new GraphPlan(d);
    Set<String> visited = new HashSet<>(), active = new HashSet<>();
    walk(starts.getFirst().id(), outgoing, visited, active);
    for (Node n : d.nodes())
      require(
          visited.contains(n.id()),
          "Every node must be reachable from Input; connect or remove unused nodes",
          n);
    for (Node n : plan.order) {
      Set<String> scope = plan.available.get(n.id());
      validateNode(d, n, scope, resolver);
    }
  }

  private void validateNode(Definition d, Node n, Set<String> scope, RuleResolver resolver) {
    try {
      if (Set.of("FORMULA", "CONDITION", "OUTPUT").contains(n.type()))
        expression(n.expression(), scope, n.label());
      if (n.type().equals("SWITCH")) {
        require(n.cases() != null && !n.cases().isEmpty(), n.label() + ": add at least one case");
        for (BranchCase option : n.cases())
          expression(option.expression(), scope, n.label() + " / Case " + option.label());
      }
      if (n.type().equals("TRANSFORM")) {
        if (n.fields() == null || n.fields().isEmpty())
          expression(n.expression(), scope, n.label());
        else
          for (Field field : n.fields())
            expression(field.expression(), scope, n.label() + " / Field " + field.name());
      }
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
      if (n.storesResult()) {
        require(identifier(n.output()), n.label() + ": provide a valid result variable");
        require(
            d.inputs().stream().noneMatch(p -> p.name().equals(n.output())),
            n.label() + ": cannot overwrite input " + n.output());
      }
    } catch (ArcException e) {
      throw e.atNode(null, null, n.id(), n.label());
    }
  }

  public record Problem(String message, List<ArcException.Location> locations) {
    public static Problem from(ArcException e) {
      return new Problem(e.getMessage(), e.locations());
    }
  }

  public List<Problem> diagnostics(Definition d, RuleResolver resolver) {
    var problems = new LinkedHashSet<Problem>();
    try {
      shape(d);
    } catch (ArcException e) {
      try {
        validate(d, resolver);
      } catch (ArcException located) {
        problems.add(Problem.from(located));
      }
      return new ArrayList<>(problems);
    }
    Map<String, Set<String>> scope = null;
    try {
      scope = new GraphPlan(d).available;
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    for (Node n : d.nodes()) {
      try {
        if (scope != null) validateNode(d, n, scope.getOrDefault(n.id(), Set.of()), resolver);
        else {
          if (Set.of("FORMULA", "CONDITION", "OUTPUT").contains(n.type()))
            Expressions.compile(n.expression());
          if (n.bindings() != null)
            for (String expr : n.bindings().values()) Expressions.compile(expr);
          if (n.cases() != null)
            for (BranchCase option : n.cases()) Expressions.compile(option.expression());
          if (n.fields() != null)
            for (Field field : n.fields()) Expressions.compile(field.expression());
          if (n.type().equals("TRANSFORM") && (n.fields() == null || n.fields().isEmpty()))
            Expressions.compile(n.expression());
        }
      } catch (ArcException e) {
        problems.add(Problem.from(e.atNode(null, null, n.id(), n.label())));
      }
    }
    Node input = d.nodes().stream().filter(n -> n.type().equals("INPUT")).findFirst().orElse(null);
    var names = d.inputs().stream().map(Input::name).collect(Collectors.toSet());
    for (Input p : d.inputs())
      if (p.source() != null) {
        for (var binding : p.source().bindings().entrySet())
          try {
            expression(binding.getValue(), names, p.name() + " source / " + binding.getKey());
          } catch (ArcException e) {
            problems.add(
                Problem.from(input == null ? e : e.atNode(null, null, input.id(), input.label())));
          }
      }
    try {
      validate(d, resolver);
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    return new ArrayList<>(problems);
  }

  private void require(boolean condition, String message, Node node) {
    if (!condition) throw ArcException.invalid(message).atNode(null, null, node.id(), node.label());
  }

  private Set<String> handles(Node node) {
    if (node.type().equals("OUTPUT")) return Set.of();
    if (node.type().equals("CONDITION")) return Set.of("true", "false");
    if (node.type().equals("SWITCH")) {
      var handles = new LinkedHashSet<String>();
      if (node.cases() != null)
        for (BranchCase option : node.cases()) handles.add("case:" + option.id());
      handles.add("default");
      return handles;
    }
    return Set.of("next");
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
