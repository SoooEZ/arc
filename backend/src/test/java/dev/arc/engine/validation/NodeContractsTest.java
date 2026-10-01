package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.edge;
import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.Definition;
import dev.arc.model.Definition.BranchCase;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Field;
import dev.arc.model.Definition.Node;
import dev.arc.model.NodeKind;
import dev.arc.model.NodeKind.Property;
import dev.arc.support.GraphFixtures.NodeBuilder;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Per-kind node facts as validation reports them: handles, Input nodes and owned expressions. */
class NodeContractsTest {
  private final Validator validator = new Validator();
  private final RuleResolver noRules =
      (id, version) -> {
        throw new ArcException(404, "Published rule version not found: " + id + " v" + version);
      };

  private static Node node(String id, String type, String expression) {
    return nodeOf(id, type, id.toUpperCase()).expression(expression).build();
  }

  private static Definition graph(List<Node> nodes, List<Edge> edges) {
    return new Definition(1, List.of(), nodes, edges);
  }

  @Test
  void missingConnectionsNameTheExpectedHandlesInCanvasOrder() {
    var condition =
        graph(
            List.of(
                node("in", "INPUT", null),
                node("check", "CONDITION", "true"),
                node("yes", "OUTPUT", "1")),
            List.of(edge("in", "check", "next"), edge("check", "yes", "true")));
    var cases = List.of(new BranchCase("a", "A", "true"), new BranchCase("b", "B", "true"));
    var switchNode = nodeOf("route", "SWITCH", "ROUTE").cases(cases).build();
    var route =
        graph(
            List.of(node("in", "INPUT", null), switchNode, node("out", "OUTPUT", "1")),
            List.of(edge("in", "route", "next"), edge("route", "out", "case:a")));
    var formula =
        graph(
            List.of(
                node("in", "INPUT", null),
                nodeOf("calc", "FORMULA", "CALC").expression("1").output("v").build()),
            List.of(edge("in", "calc", "next")));
    var output =
        graph(
            List.of(
                node("in", "INPUT", null), node("out", "OUTPUT", "1"), node("more", "OUTPUT", "2")),
            List.of(edge("in", "out", "next"), edge("out", "more", "next")));

    assertConnectionProblem(condition, "CHECK: connect [true, false]", "check");
    assertConnectionProblem(route, "ROUTE: connect [case:a, case:b, default]", "route");
    assertConnectionProblem(formula, "CALC: connect [next]", "calc");
    assertConnectionProblem(output, "OUT: connect no outgoing branches", "out");
  }

  private void assertConnectionProblem(Definition definition, String message, String nodeId) {
    assertThatThrownBy(() -> validator.validate(definition, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo(message);
              assertThat(error.locations())
                  .containsExactly(new Location(null, null, nodeId, nodeId.toUpperCase()));
            });
  }

  @Test
  void aDraftWithSeveralInputNodesShowsTheCountProblemOnTheFirst() {
    var draft =
        graph(
            List.of(
                node("first", "INPUT", null),
                node("second", "INPUT", null),
                node("out", "OUTPUT", "1")),
            List.of(edge("first", "out", "next")));

    assertThat(validator.diagnose(draft, noRules).problems())
        .containsExactly(
            new Validator.Problem(
                "A rule must have exactly one Input node",
                List.of(new Location(null, null, "first", "FIRST"))));
  }

  /**
   * A property that a node's kind does not use was once ignored. Stored drafts and published
   * versions are checked again whenever they are saved, published, executed or diagnosed, so one
   * that still holds such a property fails at that node until it is removed.
   */
  @Test
  void aPropertyTheKindDoesNotUseIsRejectedAtItsNode() {
    var messages =
        Map.of(
            Property.EXPRESSION,
            "Expressions belong to Formula, Condition, Transform and Output nodes",
            Property.OUTPUT,
            "Result variables belong to Formula, Transform and Reference nodes",
            Property.RULE,
            "Rule references belong to Reference nodes",
            Property.BINDINGS,
            "Parameter bindings belong to Reference nodes",
            Property.SELECTOR,
            "Selectors belong to Switch nodes",
            Property.CASES,
            "Cases belong to Switch nodes",
            Property.FIELDS,
            "Fields belong to Transform nodes",
            Property.OUTPUT_NAME,
            "Output names belong to Output nodes");
    for (NodeKind kind : NodeKind.values())
      for (Property property : Property.values()) {
        if (kind.uses(property)) continue;
        Node extra = setting(nodeOf("extra", kind.name(), "Extra"), property).build();
        var draft = graph(List.of(node("in", "INPUT", null), extra), List.of());
        String message = messages.get(property);
        assertThat(validator.diagnose(draft, noRules).problems())
            .as(kind + " " + property)
            .containsExactly(
                new Validator.Problem(
                    message, List.of(new Location(null, null, "extra", "Extra"))));
        assertThatThrownBy(() -> validator.validate(draft, noRules))
            .as(kind + " " + property)
            .hasMessage(message);
      }
  }

  /** Sets one property to a value that a kind using it would accept. */
  private static NodeBuilder setting(NodeBuilder node, Property property) {
    return switch (property) {
      case EXPRESSION -> node.expression("1");
      case OUTPUT -> node.output("value");
      case RULE -> node.rule("other-rule", 1);
      case BINDINGS -> node.bindings(Map.of("amount", "1"));
      case SELECTOR -> node.selector("1");
      case CASES -> node.cases(List.of(new BranchCase("one", "One", "true")));
      case FIELDS -> node.fields(List.of(new Field("value", "1")));
      case OUTPUT_NAME -> node.outputName("total");
    };
  }

  @Test
  void referencePinsFollowTheResourceIdPolicy() {
    // Malformed pins saved and built before, then failed as 404, or as 500 with a NUL in SQL.
    for (String ruleId : List.of("Bad ID!", "", "x".repeat(81), "a\0b")) {
      var reference = nodeOf("reuse", "REFERENCE", "Reuse").rule(ruleId, 1).build();
      var draft = graph(List.of(node("in", "INPUT", null), reference), List.of());
      assertThatThrownBy(() -> validator.shape(draft))
          .as(ruleId)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo("Reuse: choose a valid rule ID");
                assertThat(error.locations())
                    .containsExactly(new Location(null, null, "reuse", "Reuse"));
              });
    }
    // No rule chosen yet, or a rule chosen before its version, is a valid draft.
    validator.shape(
        graph(
            List.of(node("in", "INPUT", null), nodeOf("reuse", "REFERENCE", "Reuse").build()),
            List.of()));
    validator.shape(
        graph(
            List.of(
                node("in", "INPUT", null),
                nodeOf("reuse", "REFERENCE", "Reuse").rule("child", null).build()),
            List.of()));
  }
}
