package dev.arc.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
    /**
     * What an execution does when the read fails; the JSON {@code onError} is the constant's name.
     */
    public enum OnError {
      /** The execution fails with the read's error. */
      FAIL,
      /** The input takes its default value. */
      DEFAULT;

      /** The policy that {@code onError} names exactly; empty for null or an unknown name. */
      public static Optional<OnError> parse(String name) {
        for (OnError policy : values()) if (policy.name().equals(name)) return Optional.of(policy);
        return Optional.empty();
      }
    }

    /** Whether a failed read gives the input its default value instead of failing. */
    public boolean fallsBackToDefault() {
      return OnError.parse(onError).orElse(null) == OnError.DEFAULT;
    }

    SourceBinding detached() {
      return new SourceBinding(id, version, Frozen.map(bindings), pointer, onError);
    }
  }

  /**
   * A declared input. {@code required} is boxed so that a request which omits the flag, or sends
   * null, is seen by the draft-shape check and refused, instead of being read as optional (lesson
   * B29); every reader treats only an explicit {@code true} as required.
   */
  public record Input(
      String name, String type, Boolean required, Object defaultValue, SourceBinding source) {
    public Input(String name, String type, boolean required, Object defaultValue) {
      this(name, type, required, defaultValue, null);
    }

    /** Whether the input was declared required; an undeclared flag never counts as required. */
    public boolean isRequired() {
      return Boolean.TRUE.equals(required);
    }

    /**
     * Whether a caller must bind or pass this input: it is required and has neither a default nor a
     * source to fall back on. Reference bindings, {@code @id:version} arguments and source mappings
     * are all checked against this one rule.
     */
    public boolean needsCallerValue() {
      return isRequired() && defaultValue == null && source == null;
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
   * A decision table: condition columns, each an expression evaluated once, and rows holding one
   * test per condition and one result expression per result column. The rows that {@code hitPolicy}
   * selects among those whose tests all hold produce the node's value; a missing policy is {@link
   * HitPolicy#FIRST}. The policy stays text, as {@code onError} does, so draft shape can name the
   * policies when a request misspells one.
   */
  public record DecisionTable(
      String hitPolicy, List<Condition> conditions, List<Result> results, List<Row> rows) {
    /** Which matching rows produce the value; the JSON {@code hitPolicy} is the constant's name. */
    public enum HitPolicy {
      /** The first row whose tests hold, in table order. */
      FIRST,
      /** The one row whose tests hold; a second matching row fails the run. */
      UNIQUE,
      /** Every row whose tests hold, in table order, as a list. */
      COLLECT;

      /** The policy that {@code hitPolicy} names exactly; empty for null or an unknown name. */
      public static Optional<HitPolicy> parse(String name) {
        for (HitPolicy policy : values())
          if (policy.name().equals(name)) return Optional.of(policy);
        return Optional.empty();
      }
    }

    /**
     * The policy the rows are matched by: {@link HitPolicy#FIRST} when none is chosen. Draft shape
     * rejects an unknown name, so use this on checked tables only.
     */
    public HitPolicy policy() {
      if (hitPolicy == null) return HitPolicy.FIRST;
      return HitPolicy.parse(hitPolicy)
          .orElseThrow(() -> new IllegalStateException("Unknown hit policy: " + hitPolicy));
    }

    /** A condition column: the value its tests compare, and the label that names the column. */
    public record Condition(String label, String expression) {}

    /** A result column: the field it fills when a table has several results. */
    public record Result(String name) {}

    /** One row: a test per condition column, then a result expression per result column. */
    public record Row(List<String> when, List<String> then) {
      Row detached() {
        return new Row(Frozen.list(when), Frozen.list(then));
      }
    }

    /**
     * The expressions the table holds: each condition's, then each row's results in table order.
     * Tests are not expressions. A stored table is read as it is: a missing list, column, row or
     * cell holds nothing.
     */
    List<String> expressionTexts() {
      var texts = new ArrayList<String>();
      if (conditions != null)
        for (Condition condition : conditions)
          if (condition != null) texts.add(condition.expression());
      if (rows != null)
        for (Row row : rows) if (row != null && row.then() != null) texts.addAll(row.then());
      return texts;
    }

    DecisionTable detached() {
      return new DecisionTable(
          hitPolicy,
          Frozen.list(conditions),
          Frozen.list(results),
          Frozen.list(rows, Row::detached));
    }
  }

  /**
   * One graph node. Its {@code type} selects the {@link NodeKind}; the kind decides which of the
   * optional fields the node uses. {@code table} is written only when set ({@code
   * engine.DefinitionJson}), so the JSON of every other node, stored or sent, is what it was before
   * decision tables.
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
      String outputName,
      DecisionTable table) {
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
        case TABLE -> table != null;
      };
    }

    /**
     * Every expression text the node holds, whatever its type, property by property: its
     * expression, its binding values, its selector, each case's and field's expression and a
     * decision table's condition and result expressions; an unset expression or selector is null.
     * The rules a stored draft or version calls (its callee set, which keeps them from deletion)
     * are read from these texts, so the switch below makes a new property say whether it holds
     * expressions. A stored row is read as it is: a missing list, case or field holds nothing.
     */
    public List<String> expressionTexts() {
      var texts = new ArrayList<String>();
      for (NodeKind.Property property : NodeKind.Property.values())
        texts.addAll(expressionTexts(property));
      return texts;
    }

    private List<String> expressionTexts(NodeKind.Property property) {
      return switch (property) {
        case EXPRESSION -> Collections.singletonList(expression);
        case SELECTOR -> Collections.singletonList(selector);
        case BINDINGS -> bindings == null ? List.of() : new ArrayList<>(bindings.values());
        case CASES ->
            cases == null
                ? List.of()
                : cases.stream().filter(Objects::nonNull).map(BranchCase::expression).toList();
        case FIELDS ->
            fields == null
                ? List.of()
                : fields.stream().filter(Objects::nonNull).map(Field::expression).toList();
        case TABLE -> table == null ? List.of() : table.expressionTexts();
        case OUTPUT, RULE, OUTPUT_NAME -> List.of();
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
          outputName,
          table == null ? null : table.detached());
    }
  }

  public record Edge(String id, String source, String target, String sourceHandle) {}
}
