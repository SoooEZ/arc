package dev.arc.engine.graph;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
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
}
