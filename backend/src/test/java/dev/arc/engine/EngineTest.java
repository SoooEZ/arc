package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleSamples;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class EngineTest {
  private final Validator validator = new Validator();
  private final Engine engine = new Engine(validator);
  private final RuleResolver noRefs =
      (id, version) -> {
        throw new ArcException(404, "Missing reference");
      };

  static Node node(String id, String type, String expression, String output) {
    return new Node(id, type, id, new Position(0, 0), expression, output, null, null, null);
  }

  static Edge edge(String source, String target, String handle) {
    return new Edge(source + "-" + handle + "-" + target, source, target, handle);
  }

  private Engine.Result run(Definition d, Map<String, Object> inputs) {
    return engine.execute("test", 1, d, inputs, noRefs);
  }

  @Test
  void formulasUseTypedInputsAndTraceEachStep() {
    var result = run(RuleSamples.blank("FORMULA"), Map.of("amount", 199));
    assertThat(result.result()).isEqualTo(new BigDecimal("179.1"));
    assertThat(result.trace())
        .extracting(Engine.Step::nodeId)
        .containsExactly("input", "calculate", "result");
  }

  @Test
  void conditionsChooseBothBranchesAndUseDefaults() {
    assertThat(run(RuleSamples.blank("RULE"), Map.of("amount", 100)).result()).isEqualTo(true);
    var result = run(RuleSamples.blank("RULE"), Map.of("amount", 99));
    assertThat(result.result()).isEqualTo(false);
    assertThat(result.trace().get(1).branch()).isEqualTo("false");
    assertThat(run(RuleSamples.blank("RULE"), Map.of()).result()).isEqualTo(true);
  }

  @Test
  void inputErrorsAreNotSilentlyCoerced() {
    assertThatThrownBy(() -> run(RuleSamples.blank("RULE"), Map.of("amount", "100")))
        .hasMessageContaining("must be number");
    assertThatThrownBy(() -> run(RuleSamples.blank("RULE"), Map.of("ammount", 100)))
        .hasMessageContaining("Unknown input");
    var d =
        new Definition(
            1,
            List.of(new Input("amount", "NUMBER", true, null)),
            RuleSamples.blank("RULE").nodes(),
            RuleSamples.blank("RULE").edges());
    assertThatThrownBy(() -> run(d, Map.of())).hasMessageContaining("Missing required input");
  }

  @Test
  void referencesPinTheirVersionAndMapParameters() {
    var ref =
        new Node(
            "reuse",
            "REFERENCE",
            "reuse",
            new Position(0, 0),
            null,
            "value",
            "child",
            7,
            Map.of("amount", "amount * 2"));
    var d =
        new Definition(
            1,
            List.of(new Input("amount", "NUMBER", true, null)),
            List.of(
                node("input", "INPUT", null, null),
                ref,
                node("result", "OUTPUT", "value + 1", null)),
            List.of(edge("input", "reuse", "next"), edge("reuse", "result", "next")));
    var result =
        engine.execute(
            "parent",
            1,
            d,
            Map.of("amount", 100),
            (id, version) -> {
              assertThat(id).isEqualTo("child");
              assertThat(version).isEqualTo(7);
              return RuleSamples.blank("FORMULA");
            });
    assertThat(result.result()).isEqualTo(new BigDecimal("181.0"));
    assertThat(result.trace())
        .anyMatch(s -> s.ruleId().equals("child") && s.depth() == 1 && s.version() == 7);
  }

  @Test
  void unreachableBranchIsNotEvaluated() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                node("test", "CONDITION", "true", null),
                node("yes", "OUTPUT", "42", null),
                node("no", "OUTPUT", "1 / 0", null)),
            List.of(
                edge("input", "test", "next"),
                edge("test", "yes", "true"),
                edge("test", "no", "false")));
    assertThat(run(d, Map.of()).result()).isEqualTo(new BigDecimal("42"));
  }

  @Test
  void circularReferencesAreBounded() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                new Node(
                    "reuse",
                    "REFERENCE",
                    "reuse",
                    new Position(0, 0),
                    null,
                    "value",
                    "test",
                    1,
                    Map.of()),
                node("result", "OUTPUT", "value", null)),
            List.of(edge("input", "reuse", "next"), edge("reuse", "result", "next")));
    assertThatThrownBy(() -> engine.execute("test", 1, d, Map.of(), (id, v) -> d))
        .hasMessageContaining("Circular rule reference");
  }

  @Test
  void optionalInputsSupportNullChecks() {
    var d =
        new Definition(
            1,
            List.of(new Input("amount", "NUMBER", false, null)),
            List.of(
                node("input", "INPUT", null, null),
                node("result", "OUTPUT", "if(amount == null, 0, amount)", null)),
            List.of(edge("input", "result", "next")));
    assertThat(run(d, Map.of()).result()).isEqualTo(BigDecimal.ZERO);
  }
}
