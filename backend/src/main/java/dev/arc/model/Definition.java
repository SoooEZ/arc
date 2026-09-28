package dev.arc.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Portable executable graph. Presentation coordinates never affect execution. */
public record Definition(
    int schemaVersion, List<Input> inputs, List<Node> nodes, List<Edge> edges, List<String> notes) {
  public Definition(int schemaVersion, List<Input> inputs, List<Node> nodes, List<Edge> edges) {
    this(schemaVersion, inputs, nodes, edges, List.of());
  }

  /**
   * The Input node, which receives the declared inputs: the first node of type {@code INPUT}.
   * Validation requires exactly one in an executable graph. An unfinished draft may have none, or
   * several; its whole-graph problems are then shown on the first.
   */
  public Optional<Node> inputNode() {
    return nodesOf(NodeKind.INPUT).stream().findFirst();
  }

  /**
   * The nodes of one kind, in document order. Unvalidated documents are accepted: a missing node
   * list, null nodes and unknown types match no kind.
   */
  public List<Node> nodesOf(NodeKind kind) {
    var matches = new ArrayList<Node>();
    if (nodes != null)
      for (Node node : nodes)
        if (node != null && kind.name().equals(node.type())) matches.add(node);
    return List.copyOf(matches);
  }

  /**
   * A copy that shares no list or map with this definition; input defaults are frozen at every
   * level. A compiled plan keeps this copy, so later changes to the caller's collections cannot
   * reach it. A document without its input, node or edge list is returned as it is, for validation
   * to report.
   */
  public Definition detached() {
    if (inputs == null || nodes == null || edges == null) return this;
    return new Definition(
        schemaVersion,
        Frozen.list(inputs, Input::detached),
        Frozen.list(nodes, Node::detached),
        Frozen.list(edges),
        Frozen.list(notes));
  }

  public record SourceBinding(
      String id, int version, Map<String, String> bindings, String pointer, String onError) {
    SourceBinding detached() {
      return new SourceBinding(id, version, Frozen.map(bindings), pointer, onError);
    }
  }

  public record Input(
      String name, String type, boolean required, Object defaultValue, SourceBinding source) {
    public Input(String name, String type, boolean required, Object defaultValue) {
      this(name, type, required, defaultValue, null);
    }

    /**
     * Whether a caller must bind or pass this input: it is required and has neither a default nor a
     * source to fall back on. Reference bindings, {@code @id:version} arguments and source mappings
     * are all checked against this one rule.
     */
    public boolean needsCallerValue() {
      return required && defaultValue == null && source == null;
    }

    Input detached() {
      return new Input(
          name,
          type,
          required,
          Frozen.value(defaultValue),
          source == null ? null : source.detached());
    }
  }

  public record Position(double x, double y) {}

  /** Case identity stays stable when its label, expression or priority changes. */
  public record BranchCase(String id, String label, String expression) {}

  public record Field(String name, String expression) {}

  /**
   * One graph node. Its {@code type} selects the {@link NodeKind}; the kind decides which of the
   * optional fields the node uses.
   */
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
      List<Field> fields,
      String selector,
      String outputName) {
    /**
     * The kind that {@code type} names. Draft-shape validation rejects unknown types, so use this
     * on validated definitions only; {@link Definition#nodesOf} also reads unvalidated ones.
     */
    public NodeKind kind() {
      return NodeKind.parse(type)
          .orElseThrow(() -> new IllegalStateException("Unknown node type: " + type));
    }

    public boolean storesResult() {
      return kind().storesResult();
    }

    /**
     * The result variable this node stores, or null: empty and missing both mean that no name is
     * chosen yet, as the code view writes and reads it, so scope analysis, draft shape and the
     * renderer never see an empty name.
     */
    public String resultName() {
      return output == null || output.isEmpty() ? null : output;
    }

    /** An Output's field name, or null: empty and missing both mean no name is chosen yet. */
    public String outputFieldName() {
      return outputName == null || outputName.isEmpty() ? null : outputName;
    }

    /** Whether the node sets the property: an unset property is null. */
    public boolean sets(NodeKind.Property property) {
      return switch (property) {
        case EXPRESSION -> expression != null;
        case OUTPUT -> output != null;
        case RULE -> ruleId != null || version != null;
        case BINDINGS -> bindings != null;
        case SELECTOR -> selector != null;
        case CASES -> cases != null;
        case FIELDS -> fields != null;
        case OUTPUT_NAME -> outputName != null;
      };
    }

    /** The handles this node connects, in canvas order (see {@link NodeKind#handles}). */
    public List<String> handles() {
      return kind().handles(cases);
    }

    Node detached() {
      return new Node(
          id,
          type,
          label,
          position,
          expression,
          output,
          ruleId,
          version,
          Frozen.map(bindings),
          Frozen.list(cases),
          Frozen.list(fields),
          selector,
          outputName);
    }
  }

  public record Edge(String id, String source, String target, String sourceHandle) {}
}
