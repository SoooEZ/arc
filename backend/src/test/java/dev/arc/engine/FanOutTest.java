package dev.arc.engine;

import static dev.arc.engine.EngineTest.*;
import static org.assertj.core.api.Assertions.*;

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
    return engine.execute("test", 1, d, Map.of(), noRefs);
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
    assertThat(new GraphPlan(d).available.get("total"))
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
    assertThat(new GraphPlan(d).available.get("sum")).contains("a", "b");
    assertThat(new GraphPlan(d).available.get("out")).contains("combined").doesNotContain("a", "b");
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
  void nestedRuntimeErrorsKeepChildLocationAndCallerContext() {
    var child =
        graph(List.of(input, node("bad", "OUTPUT", "1 / 0", null)), edge("input", "bad", "next"));
    var parent =
        graph(
            List.of(
                input,
                new Node("reuse", "REFERENCE", "Child rule", null, null, "x", "child", 7, Map.of()),
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
