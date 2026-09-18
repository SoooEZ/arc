package dev.arc.model;

import java.util.List;
import java.util.Map;

/** Portable executable graph. Presentation coordinates never affect execution. */
public record Definition(
    int schemaVersion, List<Input> inputs, List<Node> nodes, List<Edge> edges, List<String> notes) {
  public Definition(int schemaVersion, List<Input> inputs, List<Node> nodes, List<Edge> edges) {
    this(schemaVersion, inputs, nodes, edges, List.of());
  }

  public record SourceBinding(
      String id, int version, Map<String, String> bindings, String pointer, String onError) {}

  public record Input(
      String name, String type, boolean required, Object defaultValue, SourceBinding source) {
    public Input(String name, String type, boolean required, Object defaultValue) {
      this(name, type, required, defaultValue, null);
    }
  }

  public record Position(double x, double y) {}

  /** Case identity stays stable when its label, predicate or priority changes. */
  public record BranchCase(String id, String label, String expression) {}

  public record Field(String name, String expression) {}

  public record Node(
      String id,
      String type,
      String label,
      Position position,
      String expression,
      String output,
      String ruleId,
      Integer version,
      Map<String, String> bindings,
      List<BranchCase> cases,
      List<Field> fields) {
    public Node(
        String id,
        String type,
        String label,
        Position position,
        String expression,
        String output,
        String ruleId,
        Integer version,
        Map<String, String> bindings) {
      this(id, type, label, position, expression, output, ruleId, version, bindings, null, null);
    }

    public boolean storesResult() {
      return "FORMULA".equals(type) || "REFERENCE".equals(type) || "TRANSFORM".equals(type);
    }
  }

  public record Edge(String id, String source, String target, String sourceHandle) {}
}
