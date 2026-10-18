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

  /**
   * A missing connection names only the exits still missing, by the captions the canvas shows, in
   * canvas order: the message listed every handle ID ("connect [true, false]") although True was
   * connected.
   */
  @Test
  void missingConnectionsNameTheMissingExitsByTheirCaptionsInCanvasOrder() {
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

    assertConnectionProblem(condition, "CHECK: connect the False exit", "check");
    assertConnectionProblem(route, "ROUTE: connect the B and Default exits", "route");
    assertConnectionProblem(formula, "CALC: connect it to a next step", "calc");
    assertConnectionProblem(
        output, "OUT: remove its outgoing connections, since an Output ends the path", "out");
  }

  @Test
  void anUnconnectedConditionAsksForBothExitsAndAMissingCaseByItsLabel() {
    var condition =
        graph(
            List.of(node("in", "INPUT", null), node("check", "CONDITION", "true")),
            List.of(edge("in", "check", "next")));
    var cases =
        List.of(new BranchCase("a", "Gold", "true"), new BranchCase("b", "Silver", "false"));
    var route =
        graph(
            List.of(
                node("in", "INPUT", null),
                nodeOf("route", "SWITCH", "ROUTE").cases(cases).build(),
                node("out", "OUTPUT", "1")),
            List.of(
                edge("in", "route", "next"),
                edge("route", "out", "case:a"),
                edge("route", "out", "default")));

    assertConnectionProblem(condition, "CHECK: connect the True and False exits", "check");
    assertConnectionProblem(route, "ROUTE: connect the Silver exit", "route");
  }

  /**
   * A connection from an exit its node does not have is named, and nothing else is reported: the
   * node was told to "connect [true, false]" although both were connected, and the target, reached
   * by no exit the node can take, reported its declared input as unavailable.
   */
  @Test
  void aConnectionFromAnExitTheNodeDoesNotHaveIsNamedAndNothingElse() {
    var definition =
        new Definition(
            1,
            List.of(new Definition.Input("amount", "NUMBER", true, null)),
            List.of(
                node("in", "INPUT", null),
                node("check", "CONDITION", "amount > 1"),
                node("yes", "OUTPUT", "amount"),
                node("no", "OUTPUT", "0"),
                node("extra", "OUTPUT", "amount * 2")),
            List.of(
                edge("in", "check", "next"),
                edge("check", "yes", "true"),
                edge("check", "no", "false"),
                edge("check", "extra", "case:old")));
    String stray = "CHECK: remove the connection from case:old, which this node does not have";
    assertThat(validator.diagnose(definition, noRules).problems())
        .containsExactly(
            new Validator.Problem(stray, List.of(new Location(null, null, "check", "CHECK"))));
    assertConnectionProblem(definition, stray, "check");
  }

  /**
   * A variable an expression cannot read is explained by whether anything declares it: renaming the
   * input amount to orderTotal left "amount" in every expression that read it, and each said
   * "Variables unavailable on every incoming path: amount" although no path could ever set it.
   */
  @Test
  void anUnavailableVariableSaysWhetherAnyInputOrResultDeclaresIt() {
    var definition =
        new Definition(
            1,
            List.of(new Definition.Input("orderTotal", "NUMBER", true, null)),
            List.of(
                node("in", "INPUT", null),
                node("check", "CONDITION", "amount >= 100"),
                nodeOf("calc", "FORMULA", "CALC")
                    .expression("amount * rate")
                    .output("total")
                    .build(),
                nodeOf("bonus", "FORMULA", "BONUS").expression("2").output("extra_points").build(),
                node("out", "OUTPUT", "total"),
                node("mixed", "OUTPUT", "total + extra"),
                node("partial", "OUTPUT", "total * extra_points")),
            List.of(
                edge("in", "check", "next"),
                edge("check", "calc", "true"),
                edge("calc", "bonus", "next"),
                edge("bonus", "out", "next"),
                edge("check", "mixed", "false"),
                edge("check", "partial", "false")));

    assertThat(validator.diagnose(definition, noRules).problems())
        .extracting(Validator.Problem::message)
        .containsExactlyInAnyOrder(
            "CHECK: uses amount, which no input or result variable provides; correct the name or"
                + " add an input named amount",
            "CALC: uses amount and rate, which no input or result variable provides; correct the"
                + " names or add inputs with those names",
            "MIXED: uses extra, which no input or result variable provides; correct the name or add"
                + " an input named extra. It also uses total, which is not set on every path into"
                + " this step; set it on each path that leads here",
            "PARTIAL: uses extra_points and total, which are not set on every path into this step;"
                + " set them on each path that leads here");
  }

  /**
   * One undeclared name that closely misspells a declared one asks whether that one was meant
   * ({@link NameSuggestions}), in a node expression and in a source mapping alike. Several
   * undeclared names, and names that only some paths set, keep their advice.
   */
  @Test
  void aCloseMisspellingOfADeclaredNameAsksWhetherItWasMeant() {
    var definition =
        new Definition(
            1,
            List.of(
                new Definition.Input("amount", "NUMBER", true, null),
                new Definition.Input("rate", "NUMBER", true, null)),
            List.of(
                node("in", "INPUT", null),
                node("check", "CONDITION", "amont >= 100"),
                nodeOf("calc", "FORMULA", "CALC")
                    .expression("amount * rate")
                    .output("total")
                    .build(),
                node("out", "OUTPUT", "TOTAL"),
                node("mixed", "OUTPUT", "rat + total"),
                node("two", "OUTPUT", "amont + rat")),
            List.of(
                edge("in", "check", "next"),
                edge("check", "calc", "true"),
                edge("calc", "out", "next"),
                edge("check", "mixed", "false"),
                edge("check", "two", "false")));

    assertThat(validator.diagnose(definition, noRules).problems())
        .extracting(Validator.Problem::message)
        .containsExactlyInAnyOrder(
            "CHECK: uses amont, which no input or result variable provides; did you mean amount?",
            "OUT: uses TOTAL, which no input or result variable provides; did you mean total?",
            "MIXED: uses rat, which no input or result variable provides; did you mean rate? It"
                + " also uses total, which is not set on every path into this step; set it on each"
                + " path that leads here",
            "TWO: uses amont and rat, which no input or result variable provides; correct the names"
                + " or add inputs with those names");

    var sourced =
        new Definition(
            1,
            List.of(
                new Definition.Input("country", "STRING", true, null),
                new Definition.Input(
                    "rate",
                    "NUMBER",
                    true,
                    null,
                    new Definition.SourceBinding(
                        "rates", 1, Map.of("key", "contry"), null, "FAIL"))),
            List.of(node("in", "INPUT", null), node("out", "OUTPUT", "rate")),
            List.of(edge("in", "out", "next")));
    assertThat(validator.diagnose(sourced, noRules).problems())
        .extracting(Validator.Problem::message)
        .containsExactly(
            "rate source / key: uses contry, which is not an input of this rule; did you mean"
                + " country?");
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
