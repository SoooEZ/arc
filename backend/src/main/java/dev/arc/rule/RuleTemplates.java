package dev.arc.rule;

import static dev.arc.model.NodeKind.*;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.RuleKind;
import java.util.List;

/** The graphs new rules start from, and the node builders the sample rules share. */
public final class RuleTemplates {
  private RuleTemplates() {}

  /**
   * The valid template a new rule of the kind starts from: a Condition with two Outputs for a RULE,
   * and one calculation for a FORMULA or DECISION_TREE (a tree grows from the calculation by hand).
   */
  public static Definition blank(RuleKind kind) {
    return switch (kind) {
      case RULE -> conditionTemplate();
      case FORMULA, DECISION_TREE -> calculationTemplate();
    };
  }

  private static Definition conditionTemplate() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            node("input", INPUT, "Inputs", 300, 0, null, null),
            node("condition", CONDITION, "Check amount", 300, 160, "amount >= 100", null),
            node("yes", OUTPUT, "Eligible", 100, 340, "true", null),
            node("no", OUTPUT, "Not eligible", 500, 340, "false", null)),
        List.of(
            edge("input", "condition", Handles.NEXT),
            edge("condition", "yes", Handles.TRUE),
            edge("condition", "no", Handles.FALSE)));
  }

  private static Definition calculationTemplate() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            node("input", INPUT, "Inputs", 280, 0, null, null),
            node("calculate", FORMULA, "Calculate", 280, 160, "amount * 0.9", "total"),
            node("result", OUTPUT, "Return total", 280, 320, "total", null)),
        List.of(
            edge("input", "calculate", Handles.NEXT), edge("calculate", "result", Handles.NEXT)));
  }

  /**
   * A node at a canvas position, with an expression and a result variable where its kind uses them.
   */
  static Node node(
      String id,
      NodeKind kind,
      String label,
      double x,
      double y,
      String expression,
      String output) {
    return new Node(
        id,
        kind.name(),
        label,
        new Position(x, y),
        expression,
        output,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** A connection with the {@code source-handle-target} ID that the code view also generates. */
  static Edge edge(String source, String target, String handle) {
    return new Edge(source + "-" + handle + "-" + target, source, target, handle);
  }
}
