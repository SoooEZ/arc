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
import dev.arc.model.Definition.Node;
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

    assertThat(validator.diagnostics(draft, noRules))
        .containsExactly(
            new Validator.Problem(
                "A rule must have exactly one Input node",
                List.of(new Location(null, null, "first", "FIRST"))));
  }

  /**
   * Stored drafts and published versions may hold bindings on nodes that are not References.
   * Executable checks ignore them, so such versions keep running; only the syntax check of a graph
   * without a scope plan parses them.
   */
  @Test
  void bindingsOnNodesThatDoNotOwnThemAreParsedOnlyWithoutAScopePlan() {
    var calc =
        nodeOf("calc", "FORMULA", "Calc")
            .expression("1")
            .output("v")
            .rule("other-rule", 3)
            .bindings(Map.of("a", "1 +"))
            .build();
    var nodes = List.of(node("in", "INPUT", null), calc, node("out", "OUTPUT", "v"));
    var acyclic = graph(nodes, List.of(edge("in", "calc", "next"), edge("calc", "out", "next")));
    var cyclic =
        graph(
            nodes,
            List.of(
                edge("in", "calc", "next"),
                edge("calc", "out", "next"),
                edge("out", "calc", "next")));

    validator.validate(acyclic, noRules);
    assertThat(validator.diagnostics(acyclic, noRules)).isEmpty();
    assertThat(Validator.dependencies(acyclic)).isEmpty();
    assertThat(validator.diagnostics(cyclic, noRules))
        .contains(
            new Validator.Problem(
                "Calc / a: Incomplete expression",
                List.of(new Location(null, null, "calc", "Calc"))));
  }
}
