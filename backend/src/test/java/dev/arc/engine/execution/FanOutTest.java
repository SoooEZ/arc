package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class FanOutTest {
  final Validator validator = new Validator();
  final Engine engine = new Engine(validator);
  final RuleResolver noRefs =
      (id, v) -> {
        throw new ArcException(404, "Missing reference");
      };
  final Node input = node("input", "INPUT", null, null);

  Definition graph(List<Node> nodes, Edge... edges) {
    return new Definition(1, List.of(), nodes, List.of(edges));
  }

  Engine.Result run(Definition d) {
    return run(d, Map.of());
  }

  Engine.Result run(Definition d, Map<String, Object> inputs) {
    return engine.execute("test", 1, d, inputs, noRefs);
  }

  static Node namedOutput(String id, String expression, String name) {
    return nodeOf(id, "OUTPUT", id).expression(expression).outputName(name).build();
  }

  /** Members pay listPrice * rate; the rate comes from a node that runs for everyone. */
  Definition memberPricing() {
    return new Definition(
        1,
        List.of(
            new Input("listPrice", "NUMBER", true, null),
            new Input("isMember", "BOOLEAN", true, null)),
        List.of(
            input,
            node("base", "FORMULA", "listPrice", "price"),
            node("rateNode", "FORMULA", "0.8", "rate"),
            node("memberCheck", "CONDITION", "isMember", null),
            node("member", "FORMULA", "listPrice * rate", "price"),
            node("out", "OUTPUT", "price", null)),
        List.of(
            edge("input", "base", "next"),
            edge("input", "rateNode", "next"),
            edge("base", "memberCheck", "next"),
            edge("memberCheck", "member", "true"),
            edge("memberCheck", "out", "false"),
            edge("rateNode", "member", "next"),
            edge("member", "out", "next")));
  }

  Definition diamond() {
    return graph(
        List.of(
            input,
            node("base", "FORMULA", "100", "base"),
            node("tax", "FORMULA", "base * 0.1", "tax"),
            node("shipping", "FORMULA", "base * 0.05", "shipping"),
            node("total", "OUTPUT", "base + tax + shipping", null)),
        edge("input", "base", "next"),
        edge("base", "tax", "next"),
        edge("base", "shipping", "next"),
        edge("tax", "total", "next"),
        edge("shipping", "total", "next"));
  }

  @Test
  void forksComputeIndependentlyAndJoinExactlyOnceRegardlessOfArrayOrder() {
    var d = diamond();
    var r = run(d);
    assertThat((BigDecimal) r.result()).isEqualByComparingTo(new BigDecimal("115"));
    assertThat(r.trace())
        .extracting(Engine.Step::nodeId)
        .containsExactly("input", "base", "shipping", "tax", "total");
    assertThat(new GraphPlan(d).available().get("total"))
        .containsExactlyInAnyOrder("base", "shipping", "tax");
    var ns = new ArrayList<>(d.nodes());
    Collections.reverse(ns);
    var es = new ArrayList<>(d.edges());
    Collections.reverse(es);
    assertThat(run(new Definition(1, d.inputs(), ns, es)))
        .usingRecursiveComparison()
        .ignoringFields("durationMicros")
        .isEqualTo(r);
  }

  @Test
  void multipleOutputsReturnObjectButOneActiveOutputKeepsItsValue() {
    var d =
        graph(
            List.of(
                input, node("tax", "OUTPUT", "10", null), node("shipping", "OUTPUT", "5", null)),
            edge("input", "tax", "next"),
            edge("input", "shipping", "next"));
    assertThat(run(d).result())
        .isEqualTo(Map.of("tax", new BigDecimal("10"), "shipping", new BigDecimal("5")));
    var nullable =
        graph(
            List.of(
                input, node("tax", "OUTPUT", "null", null), node("shipping", "OUTPUT", "5", null)),
            edge("input", "tax", "next"),
            edge("input", "shipping", "next"));
    assertThat(((Map<?, ?>) run(nullable).result()).containsKey("tax")).isTrue();
  }

  @Test
  void selectedBranchCanFanOutAndInactiveBranchesDoNotBlockAJoin() {
    var d =
        graph(
            List.of(
                input,
                node("check", "CONDITION", "true", null),
                node("a", "FORMULA", "10", "a"),
                node("b", "FORMULA", "20", "b"),
                node("sum", "FORMULA", "a + b", "combined"),
                node("no", "FORMULA", "1 / 0", "combined"),
                node("out", "OUTPUT", "combined", null)),
            edge("input", "check", "next"),
            edge("check", "a", "true"),
            edge("check", "b", "true"),
            edge("check", "no", "false"),
            edge("a", "sum", "next"),
            edge("b", "sum", "next"),
            edge("sum", "out", "next"),
            edge("no", "out", "next"));
    assertThat(run(d).result()).isEqualTo(new BigDecimal("30"));
    assertThat(run(d).trace()).extracting(Engine.Step::nodeId).doesNotContain("no");
    assertThat(new GraphPlan(d).available().get("sum")).contains("a", "b");
    assertThat(new GraphPlan(d).available().get("out"))
        .contains("combined")
        .doesNotContain("a", "b");
  }

  @Test
  void siblingVariablesDoNotLeakAndConditionalMissingValuesStillFailValidation() {
    var d = diamond();
    var ns =
        d.nodes().stream()
            .map(n -> n.id().equals("tax") ? node("tax", "FORMULA", "shipping + 1", "tax") : n)
            .toList();
    assertThatThrownBy(() -> run(new Definition(1, d.inputs(), ns, d.edges())))
        .isInstanceOfSatisfying(
            ArcException.class,
            e -> {
              assertThat(e.getMessage()).contains("unavailable");
              assertThat(e.locations().getFirst().nodeId()).isEqualTo("tax");
            });
  }

  @Test
  void simultaneousWritesCannotSilentlyClobberButSequentialUpdatesWork() {
    var d =
        graph(
            List.of(
                input,
                node("a", "FORMULA", "1", "x"),
                node("b", "FORMULA", "2", "x"),
                node("out", "OUTPUT", "x", null)),
            edge("input", "a", "next"),
            edge("input", "b", "next"),
            edge("a", "out", "next"),
            edge("b", "out", "next"));
    assertThatThrownBy(() -> run(d)).hasMessageContaining("Conflicting upstream values");
    var serial =
        new Definition(
            1,
            d.inputs(),
            d.nodes(),
            List.of(
                edge("input", "a", "next"),
                edge("a", "b", "next"),
                edge("a", "out", "next"),
                edge("b", "out", "next")));
    assertThat(run(serial).result()).isEqualTo(new BigDecimal("2"));
  }

  @Test
  void aWriteLinkedToAnEarlierOneOnlyThroughASkippedBranchIsIndependent() {
    var pricing = memberPricing();
    validator.validate(pricing, noRefs); // Valid: whether writes conflict depends on the inputs.
    var member = run(pricing, Map.of("listPrice", new BigDecimal("100"), "isMember", true));
    assertThat((BigDecimal) member.result()).isEqualByComparingTo("80");
    // Without the true branch, 'member' still runs from rateNode alone and never saw base's price.
    assertThatThrownBy(
            () -> run(pricing, Map.of("listPrice", new BigDecimal("100"), "isMember", false)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).startsWith("Conflicting upstream values for 'price'");
              assertThat(error.locations())
                  .containsExactly(new ArcException.Location("test", 1, "out", "out"));
            });

    var gated =
        new Definition(
            1,
            List.of(new Input("flag", "BOOLEAN", true, null)),
            List.of(
                input,
                node("b", "FORMULA", "1", "x"),
                node("k", "CONDITION", "flag", null),
                node("d", "FORMULA", "0", "y"),
                node("c", "FORMULA", "2", "x"),
                node("j", "OUTPUT", "x", null)),
            List.of(
                edge("input", "b", "next"),
                edge("input", "d", "next"),
                edge("b", "k", "next"),
                edge("b", "j", "next"),
                edge("k", "c", "true"),
                edge("k", "j", "false"),
                edge("d", "c", "next"),
                edge("c", "j", "next")));
    assertThat(run(gated, Map.of("flag", true)).result()).isEqualTo(new BigDecimal("2"));
    assertThatThrownBy(() -> run(gated, Map.of("flag", false)))
        .hasMessageStartingWith("Conflicting upstream values for 'x'");
  }

  @Test
  void anUpdateSeveralStepsDownstreamStillSupersedesTheOriginalWrite() {
    var d =
        graph(
            List.of(
                input,
                node("a", "FORMULA", "1", "x"),
                node("b", "FORMULA", "x + 1", "x"),
                node("c", "FORMULA", "x + 1", "x"),
                node("out", "OUTPUT", "x", null)),
            edge("input", "a", "next"),
            edge("a", "b", "next"),
            edge("b", "c", "next"),
            edge("a", "out", "next"),
            edge("c", "out", "next"));
    assertThat(run(d).result()).isEqualTo(new BigDecimal("3"));
  }

  @Test
  void aNodeWithoutAResultSeesItsParentScopeUnchangedBySiblingResults() {
    // 'a' updates x and runs before Condition 'c', which reads its parent p's scope.
    var d =
        graph(
            List.of(
                input,
                node("p", "FORMULA", "1", "x"),
                node("a", "FORMULA", "x + 1", "x"),
                node("c", "CONDITION", "x == 1", null),
                namedOutput("fromCondition", "x", "seenByCondition"),
                namedOutput("fromUpdate", "x", "updated")),
            edge("input", "p", "next"),
            edge("p", "a", "next"),
            edge("p", "c", "next"),
            edge("c", "fromCondition", "true"),
            edge("c", "fromCondition", "false"),
            edge("a", "fromUpdate", "next"));
    var result = run(d);
    assertThat(result.trace()).extracting(Engine.Step::nodeId).containsSubsequence("a", "c");
    assertThat(result.trace())
        .filteredOn(step -> step.nodeId().equals("c"))
        .extracting(Engine.Step::branch)
        .containsExactly("true");
    assertThat(result.result())
        .isEqualTo(Map.of("seenByCondition", new BigDecimal("1"), "updated", new BigDecimal("2")));
  }

  @Test
  void nestedRuntimeErrorsKeepChildLocationAndCallerContext() {
    var child =
        graph(List.of(input, node("bad", "OUTPUT", "1 / 0", null)), edge("input", "bad", "next"));
    var parent =
        graph(
            List.of(
                input,
                nodeOf("reuse", "REFERENCE", "Child rule")
                    .output("x")
                    .rule("child", 7)
                    .bindings(Map.of())
                    .build(),
                node("out", "OUTPUT", "x", null)),
            edge("input", "reuse", "next"),
            edge("reuse", "out", "next"));
    assertThatThrownBy(() -> engine.execute("preview", null, parent, Map.of(), (id, v) -> child))
        .isInstanceOfSatisfying(
            ArcException.class,
            e -> {
              assertThat(e.locations())
                  .containsExactly(
                      new ArcException.Location("child", 7, "bad", "bad"),
                      new ArcException.Location("preview", null, "reuse", "Child rule"));
            });
  }

  @Test
  void duplicateConnectionsAreRejectedAndScriptRoundTripsFanOut() {
    var d = diamond();
    var script = new ArcScript(new com.fasterxml.jackson.databind.ObjectMapper(), validator);
    var rebuilt = script.build(script.render(d));
    assertThat(rebuilt.diagnostics()).isEmpty();
    assertThat(rebuilt.definition()).isEqualTo(d);
    var es = new ArrayList<>(d.edges());
    var e = es.getFirst();
    es.add(new Edge("duplicate", e.source(), e.target(), e.sourceHandle()));
    assertThatThrownBy(
            () -> validator.validate(new Definition(1, d.inputs(), d.nodes(), es), noRefs))
        .hasMessageContaining("Duplicate connection");
  }
}
