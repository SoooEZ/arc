package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleSamples;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class StudioTest {
  private final ArcScript script = new ArcScript(new ObjectMapper(), new Validator());

  @Test
  void graphAndCodeRoundTripPreservesExecutionAndLayout() {
    for (String kind : List.of("RULE", "FORMULA", "DECISION_TREE")) {
      var before = RuleSamples.blank(kind);
      var build = script.build(script.render(before));
      assertThat(build.diagnostics()).isEmpty();
      assertThat(build.definition().inputs()).isEqualTo(before.inputs());
      assertThat(build.definition().nodes()).isEqualTo(before.nodes());
      assertThat(build.definition().edges()).containsExactlyInAnyOrderElementsOf(before.edges());
      var engine = new Engine(new Validator());
      RuleResolver noRefs =
          (id, v) -> {
            throw new AssertionError("Unexpected reference");
          };
      assertThat(engine.execute("before", 1, before, Map.of(), noRefs).result())
          .isEqualTo(engine.execute("after", 1, build.definition(), Map.of(), noRefs).result());
    }
  }

  @Test
  void commentsArraysSourceBindingsAndReferencesRoundTrip() {
    var definition =
        script.parse(
            """
// a documented module
schema 1;
inputs {
  items: ARRAY required default [1, 2];
  country: STRING required default "US";
  rate: NUMBER required default 0;
  source rate = {"id":"country-tax","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"DEFAULT"};
}
node input INPUT "Input" { next -> calculate; }
node calculate FORMULA "Calc" at (1.0E-6, -25) {
  let total = SUM(MAP(items, item, item * 2));
  next -> reuse;
}
node reuse REFERENCE "Reuse" {
  use "child" version 7;
  bind amount = total;
  as final;
  next -> output;
}
node output OUTPUT "Return" { return final; }
""");
    var rebuilt = script.build(script.render(definition));
    assertThat(rebuilt.diagnostics()).isEmpty();
    assertThat(rebuilt.definition()).isEqualTo(definition);
  }

  @Test
  void syntaxErrorsIncludeLocationsAndNeverProducePartialGraphs() {
    var result =
        script.build(
            "inputs { amount: NUMBER required; }\nnode bad FORMULA \"Oops\" {\n let x = 1 +;\n}");
    assertThat(result.definition()).isNull();
    assertThat(result.diagnostics().getFirst().line()).isEqualTo(3);
    assertThat(script.build("node x OUTPUT \"Oops\" { return 5 }").diagnostics()).isNotEmpty();
    assertThat(script.build("node x OUTPUT \"Oops\" { return 5; return 6; }").diagnostics())
        .isNotEmpty();
    assertThat(script.build("node x OUTPUT \"Oops\" { return 5; next -> missing; }").diagnostics())
        .isNotEmpty();
  }

  private Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  @Test
  void excelMathTextLogicAndRangesWork() {
    assertThat(eval("SUM([0.1, 0.2], 0.3)")).isEqualTo(new BigDecimal("0.6"));
    assertThat(eval("ROUND(1234, -2)")).isEqualTo(new BigDecimal("1.2E+3"));
    assertThat(eval("UPPER(LEFT(\"hello\", 3))")).isEqualTo("HEL");
    assertThat(eval("LEN(CONCAT(\"arc\", 123))")).isEqualTo(new BigDecimal("6"));
    assertThat(eval("IFERROR(1 / 0, 5)")).isEqualTo(new BigDecimal("5"));
    assertThat(eval("SWITCH(2, 1, 1/0, 2, 42, 0)")).isEqualTo(new BigDecimal("42"));
    assertThatThrownBy(() -> eval("COMBIN(1000000000, 500000000)")).hasMessageContaining("10,000");
    assertThat(eval("TRUE()")).isEqualTo(true);
    assertThat(eval("ISNA(NA())")).isEqualTo(true);
    assertThat(eval("ISERROR(1/0)")).isEqualTo(true);
    assertThat(eval("TRANSPOSE([[1, 2], [3, 4]])"))
        .isEqualTo(
            List.of(
                List.of(new BigDecimal("1"), new BigDecimal("3")),
                List.of(new BigDecimal("2"), new BigDecimal("4"))));
    assertThatThrownBy(() -> eval("REPT(\"x\", 1000000000)")).hasMessageContaining("string limit");
    assertThat(eval("2^3^2")).isEqualTo(new BigDecimal("512"));
    assertThat(eval("1 = 1.0 AND 2 <> 3")).isEqualTo(true);
    assertThat(eval("VLOOKUP(2, [[1, 10], [2, 20]], 2, false)")).isEqualTo(new BigDecimal("2E+1"));
    assertThat(Functions.catalog().stream().filter(Functions.Entry::supported).count())
        .isGreaterThan(150);
    assertThat(Functions.catalog()).anyMatch(f -> f.name().equals("INDIRECT") && !f.supported());
  }

  @Test
  void collectionsHaveLexicalScopeAndBoundedEvaluation() {
    var scope =
        Map.<String, Object>of(
            "items", List.of(Map.of("price", 10), Map.of("price", 25)), "factor", 2);
    assertThat(
            Expressions.evaluate(
                "SUM(MAP(FILTER(items, item, item.price > 10), item, item.price * factor))", scope))
        .isEqualTo(new BigDecimal("50"));
    assertThat(Expressions.compile("MAP(items, item, item.price + factor)").variables())
        .containsExactlyInAnyOrder("items", "factor");
    assertThat(Expressions.compile("MAP(items, item, item.price) + item").variables())
        .containsExactlyInAnyOrder("items", "item");
    assertThat(Expressions.evaluate("REDUCE(items, item, acc, 0, acc + item.price)", scope))
        .isEqualTo(new BigDecimal("35"));
    assertThat(Expressions.evaluate("ANY(items, item, item.price > 20)", scope)).isEqualTo(true);
    assertThat(Expressions.evaluate("PLUCK(items, \"price\")", scope)).isEqualTo(List.of(10, 25));
    var many = Map.<String, Object>of("items", Collections.nCopies(101, 1));
    assertThatThrownBy(() -> Expressions.evaluate("MAP(items, x, SUM(MAP(items, y, y)))", many))
        .hasMessageContaining("operations");
  }
}
