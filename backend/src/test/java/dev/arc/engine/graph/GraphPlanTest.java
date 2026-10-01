package dev.arc.engine.graph;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.function.IntFunction;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

class GraphPlanTest {
  private final Validator validator = new Validator();
  private final RuleResolver noReferences =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };
  private final List<Input> amount = List.of(new Input("amount", "NUMBER", true, null));

  private static List<String> cycleLocations(ThrowingCallable call) {
    var error = catchThrowableOfType(ArcException.class, call);
    assertThat(error).as("cycle error").isNotNull();
    assertThat(error.getMessage()).isEqualTo("Decision graphs cannot contain cycles");
    return error.locations().stream().map(ArcException.Location::nodeId).toList();
  }

  private static List<String> planCycle(Definition definition) {
    return cycleLocations(() -> new GraphPlan(definition));
  }

  @Test
  void aCycleIsLocatedOnItsNodesRatherThanTheFirstNodeDownstreamOfIt() {
    // The Output x is defined first but only waits for the a <-> b cycle.
    var definition =
        new Definition(
            1,
            amount,
            List.of(
                node("input", "INPUT", null, null),
                node("x", "OUTPUT", "va", null),
                node("a", "FORMULA", "amount + 1", "va"),
                node("b", "FORMULA", "va + 1", "vb")),
            List.of(
                edge("input", "a", "next"),
                edge("a", "b", "next"),
                edge("b", "a", "next"),
                edge("b", "x", "next")));
    assertThat(planCycle(definition)).containsExactly("a", "b");
    assertThat(cycleLocations(() -> validator.validate(definition, noReferences)))
        .containsExactly("a", "b");
    assertThat(validator.diagnostics(definition, noReferences))
        .filteredOn(problem -> problem.message().contains("cycles"))
        .singleElement()
        .satisfies(
            problem ->
                assertThat(problem.locations())
                    .extracting(ArcException.Location::nodeId)
                    .containsExactly("a", "b"));
  }

  @Test
  void nodesAppendedAfterATemplateOutputAreReportedWhenTheyFormTheCycle() {
    // The editor appends new nodes after the template's Output, so the Output comes first.
    var definition =
        new Definition(
            1,
            amount,
            List.of(
                node("input", "INPUT", null, null),
                node("calculate", "FORMULA", "amount * 0.9", "total"),
                node("result", "OUTPUT", "total", null),
                node("n1", "FORMULA", "total + 1", "s1"),
                node("n2", "FORMULA", "total + 2", "s2")),
            List.of(
                edge("input", "calculate", "next"),
                edge("calculate", "n1", "next"),
                edge("n1", "n2", "next"),
                edge("n2", "n1", "next"),
                edge("n2", "result", "next")));
    assertThat(planCycle(definition)).containsExactly("n1", "n2");
  }

  /**
   * An empty result name means that no name is chosen yet, as draft shape and the code view read
   * it, so a Formula, Transform or Reference with {@code output: ""} names no variable downstream.
   */
  @Test
  void anEmptyResultNameContributesNoVariableDownstream() {
    for (String type : List.of("FORMULA", "TRANSFORM", "REFERENCE")) {
      for (String output : Arrays.asList(null, "")) {
        var unnamed = nodeOf("calc", type, "Calc").output(output).build();
        var definition =
            new Definition(
                1,
                amount,
                List.of(
                    node("input", "INPUT", null, null), unnamed, node("out", "OUTPUT", "1", null)),
                List.of(edge("input", "calc", "next"), edge("calc", "out", "next")));
        assertThat(new GraphPlan(definition).available().get("out"))
            .as(type + " with output " + (output == null ? "null" : "\"\""))
            .containsExactly("amount");
      }
    }
  }

  @Test
  void aSelfLoopAndALongerCycleReportOnlyTheirOwnNodes() {
    var selfLoop =
        new Definition(
            1,
            List.of(),
            List.of(node("input", "INPUT", null, null), node("loop", "FORMULA", "1", "x")),
            List.of(edge("input", "loop", "next"), edge("loop", "loop", "next")));
    assertThat(planCycle(selfLoop)).containsExactly("loop");

    // done -> c -> d -> e -> c: only c, d and e are on the cycle; after is downstream of it.
    var longer =
        new Definition(
            1,
            List.of(),
            List.of(
                node("after", "OUTPUT", "1", null),
                node("input", "INPUT", null, null),
                node("done", "FORMULA", "1", "x"),
                node("e", "FORMULA", "1", "z"),
                node("c", "FORMULA", "1", "y"),
                node("d", "FORMULA", "1", "w")),
            List.of(
                edge("input", "done", "next"),
                edge("done", "c", "next"),
                edge("c", "d", "next"),
                edge("d", "e", "next"),
                edge("e", "c", "next"),
                edge("e", "after", "next")));
    assertThat(planCycle(longer)).containsExactly("e", "c", "d");
  }

  /**
   * "Approve if any of `pairs` two-part checks passes": Input → check_i; check_i.true → confirm_i;
   * confirm_i.true → approve (a shared Formula, then an Output); both false exits → reject.
   */
  private Definition pairedChecks(
      int pairs, IntFunction<String> check, IntFunction<String> confirm) {
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    nodes.add(node("input", "INPUT", null, null));
    nodes.add(node("approve", "FORMULA", "1", "approved"));
    nodes.add(node("result", "OUTPUT", "approved", null));
    nodes.add(node("reject", "OUTPUT", "0", null));
    edges.add(edge("approve", "result", "next"));
    for (int pair = 0; pair < pairs; pair++) {
      String first = check.apply(pair), second = confirm.apply(pair);
      nodes.add(node(first, "CONDITION", "amount > " + pair, null));
      nodes.add(node(second, "CONDITION", "amount < " + (1000 + pair), null));
      edges.add(edge("input", first, "next"));
      edges.add(edge(first, second, "true"));
      edges.add(edge(first, "reject", "false"));
      edges.add(edge(second, "approve", "true"));
      edges.add(edge(second, "reject", "false"));
    }
    return new Definition(1, amount, nodes, edges);
  }

  @Test
  void branchAnalysisDoesNotDependOnNodeNames() {
    // Grouped names ordered every check before every confirm, which made the decision diagram of
    // "any pair passes" exponential: the same graph was too complex under one naming only.
    var grouped =
        pairedChecks(14, i -> "check_%02d".formatted(i), i -> "confirm_%02d".formatted(i));
    var paired = pairedChecks(14, i -> "rule_%02d_a".formatted(i), i -> "rule_%02d_b".formatted(i));
    Map<String, Set<String>> groupedScopes = new GraphPlan(grouped).available();
    Map<String, Set<String>> pairedScopes = new GraphPlan(paired).available();
    for (String shared : List.of("input", "approve", "result", "reject"))
      assertThat(groupedScopes.get(shared)).as(shared).isEqualTo(pairedScopes.get(shared));
    for (int pair = 0; pair < 14; pair++) {
      assertThat(groupedScopes.get("check_%02d".formatted(pair)))
          .isEqualTo(pairedScopes.get("rule_%02d_a".formatted(pair)));
      assertThat(groupedScopes.get("confirm_%02d".formatted(pair)))
          .isEqualTo(pairedScopes.get("rule_%02d_b".formatted(pair)));
    }
    assertThat(groupedScopes.get("result")).isEqualTo(Set.of("amount", "approved"));
  }

  @Test
  void randomNodeIdsCannotMakeAValidGraphTooComplex() {
    // The editor names nodes shortId("node-"); at 82 nodes, 51 of 60 random namings failed.
    var random = new Random(20260927);
    for (int attempt = 0; attempt < 60; attempt++) {
      var names = new LinkedHashSet<String>();
      while (names.size() < 78) names.add("node-%08x".formatted(random.nextInt()));
      var ids = List.copyOf(names);
      var definition = pairedChecks(39, i -> ids.get(2 * i), i -> ids.get(2 * i + 1));
      assertThatCode(() -> validator.validate(definition, noReferences))
          .as("attempt " + attempt)
          .doesNotThrowAnyException();
    }
  }

  /**
   * "Approve if any rung's two checks pass" drawn as a ladder: rung_i.true → confirm_i and the next
   * rung, rung_i.false → the next rung (after the last rung, `none`); confirm_i.true → anyPair,
   * confirm_i.false → none. {@code confirmFirst} says which of a rung's true connections was drawn
   * first.
   */
  private Definition ladder(
      int rungs, boolean confirmFirst, IntFunction<String> rung, IntFunction<String> confirm) {
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    nodes.add(node("input", "INPUT", null, null));
    nodes.add(node("anyPair", "OUTPUT", "true", null));
    nodes.add(node("none", "OUTPUT", "false", null));
    edges.add(edge("input", rung.apply(0), "next"));
    for (int i = 0; i < rungs; i++) {
      String check = rung.apply(i), confirming = confirm.apply(i);
      String next = i + 1 < rungs ? rung.apply(i + 1) : "none";
      nodes.add(node(check, "CONDITION", "amount > " + i, null));
      nodes.add(node(confirming, "CONDITION", "amount < " + (1000 + i), null));
      if (confirmFirst) edges.add(edge(check, confirming, "true"));
      edges.add(edge(check, next, "true"));
      if (!confirmFirst) edges.add(edge(check, confirming, "true"));
      edges.add(edge(check, next, "false"));
      edges.add(edge(confirming, "anyPair", "true"));
      edges.add(edge(confirming, "none", "false"));
    }
    return new Definition(1, amount, nodes, edges);
  }

  @Test
  void branchAnalysisDoesNotDependOnTheOrderConnectionsWereDrawn() {
    // A handle's connections were followed in document order: with each rung's confirming check
    // drawn first, every rung was numbered before every confirmation and 13 rungs were too complex,
    // while the other drawing order passed. The canvas appends connections as they are drawn.
    IntFunction<String> rung = i -> "rung_%02d".formatted(i);
    IntFunction<String> confirm = i -> "confirm_%02d".formatted(i);
    for (boolean confirmFirst : List.of(true, false))
      assertThatCode(
              () -> validator.validate(ladder(13, confirmFirst, rung, confirm), noReferences))
          .as("confirming check drawn first: " + confirmFirst)
          .doesNotThrowAnyException();
    assertThat(new GraphPlan(ladder(13, true, rung, confirm)).available())
        .isEqualTo(new GraphPlan(ladder(13, false, rung, confirm)).available());
    var random = new Random(20261001);
    for (int attempt = 0; attempt < 20; attempt++) {
      var names = new LinkedHashSet<String>();
      while (names.size() < 78) names.add("node-%08x".formatted(random.nextInt()));
      var ids = List.copyOf(names);
      var definition = ladder(39, attempt % 2 == 0, i -> ids.get(2 * i), i -> ids.get(2 * i + 1));
      assertThatCode(() -> validator.validate(definition, noReferences))
          .as("attempt " + attempt)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void aGenuinelyExponentialAnalysisStillReportsTooComplex() {
    // "Any of 20 pairs passes" with every first test numbered before every second test.
    var logic = new BooleanConditions();
    assertThatThrownBy(
            () -> {
              int any = 0;
              for (int pair = 0; pair < 20; pair++)
                any = logic.or(any, logic.and(logic.variable(pair), logic.variable(20 + pair)));
            })
        .isInstanceOf(ArcException.class)
        .hasMessage("Branch analysis is too complex; split this graph into reusable rules");
  }
}
