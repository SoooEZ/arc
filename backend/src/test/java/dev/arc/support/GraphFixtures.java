package dev.arc.support;

import dev.arc.model.Definition;
import dev.arc.model.Definition.BranchCase;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Field;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.Position;
import java.util.List;
import java.util.Map;

/** Small graph builders shared by evaluator, validator, script and service contract tests. */
public final class GraphFixtures {
  private GraphFixtures() {}

  /**
   * Input {@code amount} (100 by default), Calculate {@code total = amount * 0.9}, Return total: a
   * complete calculation for tests that need any valid graph. It is a copy of the FORMULA template
   * when this was written, so a change to the templates new rules start from fails no engine test.
   */
  public static Definition calculation() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            nodeOf("input", "INPUT", "Inputs").at(280, 0).build(),
            nodeOf("calculate", "FORMULA", "Calculate")
                .at(280, 160)
                .expression("amount * 0.9")
                .output("total")
                .build(),
            nodeOf("result", "OUTPUT", "Return total").at(280, 320).expression("total").build()),
        List.of(edge("input", "calculate", "next"), edge("calculate", "result", "next")));
  }

  /** Input {@code amount} (100 by default), Check {@code amount >= 100}, then true or false. */
  public static Definition condition() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            nodeOf("input", "INPUT", "Inputs").at(300, 0).build(),
            nodeOf("condition", "CONDITION", "Check amount")
                .at(300, 160)
                .expression("amount >= 100")
                .build(),
            nodeOf("yes", "OUTPUT", "Eligible").at(100, 340).expression("true").build(),
            nodeOf("no", "OUTPUT", "Not eligible").at(500, 340).expression("false").build()),
        List.of(
            edge("input", "condition", "next"),
            edge("condition", "yes", "true"),
            edge("condition", "no", "false")));
  }

  /** A node labelled with its ID at (0, 0); its other optional fields are unset. */
  public static Node node(String id, String type, String expression, String output) {
    return nodeOf(id, type, id).at(0, 0).expression(expression).output(output).build();
  }

  /** An Input node without a position. */
  public static Node inputNode(String id, String label) {
    return nodeOf(id, "INPUT", label).build();
  }

  /** An Output node without a position that returns {@code expression}. */
  public static Node outputNode(String id, String label, String expression) {
    return nodeOf(id, "OUTPUT", label).expression(expression).build();
  }

  /**
   * Starts a node of any type, including types that validation rejects. Optional fields, the
   * position included, stay unset until a test sets them.
   */
  public static NodeBuilder nodeOf(String id, String type, String label) {
    return new NodeBuilder(id, type, label);
  }

  /** Starts from every field of an existing node, to change some of them. */
  public static NodeBuilder copyOf(Node node) {
    return nodeOf(node.id(), node.type(), node.label())
        .position(node.position())
        .expression(node.expression())
        .output(node.output())
        .rule(node.ruleId(), node.version())
        .bindings(node.bindings())
        .cases(node.cases())
        .fields(node.fields())
        .selector(node.selector())
        .outputName(node.outputName());
  }

  public static Edge edge(String source, String target, String handle) {
    return new Edge(source + "-" + handle + "-" + target, source, target, handle);
  }

  /** Collects a node's fields for its one canonical constructor. */
  public static final class NodeBuilder {
    private final String id;
    private final String type;
    private final String label;
    private Position position;
    private String expression;
    private String output;
    private String ruleId;
    private Integer version;
    private Map<String, String> bindings;
    private List<BranchCase> cases;
    private List<Field> fields;
    private String selector;
    private String outputName;

    private NodeBuilder(String id, String type, String label) {
      this.id = id;
      this.type = type;
      this.label = label;
    }

    public NodeBuilder at(double x, double y) {
      return position(new Position(x, y));
    }

    public NodeBuilder position(Position position) {
      this.position = position;
      return this;
    }

    public NodeBuilder expression(String expression) {
      this.expression = expression;
      return this;
    }

    /** The result variable of a Formula, Transform or Reference. */
    public NodeBuilder output(String output) {
      this.output = output;
      return this;
    }

    /** The pinned rule of a Reference. */
    public NodeBuilder rule(String ruleId, Integer version) {
      this.ruleId = ruleId;
      this.version = version;
      return this;
    }

    public NodeBuilder bindings(Map<String, String> bindings) {
      this.bindings = bindings;
      return this;
    }

    public NodeBuilder cases(List<BranchCase> cases) {
      this.cases = cases;
      return this;
    }

    public NodeBuilder fields(List<Field> fields) {
      this.fields = fields;
      return this;
    }

    public NodeBuilder selector(String selector) {
      this.selector = selector;
      return this;
    }

    public NodeBuilder outputName(String outputName) {
      this.outputName = outputName;
      return this;
    }

    public Node build() {
      return new Node(
          id,
          type,
          label,
          position,
          expression,
          output,
          ruleId,
          version,
          bindings,
          cases,
          fields,
          selector,
          outputName);
    }
  }
}
