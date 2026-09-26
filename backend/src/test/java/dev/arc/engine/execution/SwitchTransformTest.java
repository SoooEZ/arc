package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class SwitchTransformTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Engine engine = new Engine(validator);
  private final RuleResolver noRefs =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  private Definition choice() {
    return script.parse(
        """
        inputs { amount: NUMBER required; }
        node input INPUT "Input" { next -> choose; }
        node choose SWITCH "Pricing band" {
          case "VIP" "Premium" when amount >= 100;
          case "standard" "Standard" when amount >= 50;
          case:VIP -> premium;
          case:standard -> standard;
          default -> fallback;
        }
        node premium FORMULA "Premium price" { let price = amount * 0.8; next -> out; }
        node standard FORMULA "Standard price" { let price = amount * 0.9; next -> out; }
        node fallback FORMULA "Regular price" { let price = amount; next -> out; }
        node out OUTPUT "Result" { return price; }
        """);
  }

  private Engine.Result run(Definition definition, Map<String, Object> inputs) {
    return engine.execute("test", 1, definition, inputs, noRefs);
  }

  @Test
  void switchSelectsFirstMatchOrDefaultAndMutuallyExclusiveVariablesMerge() {
    var graph = choice();
    assertThat(run(graph, Map.of("amount", 100)).result()).isEqualTo(new BigDecimal("80.0"));
    assertThat(run(graph, Map.of("amount", 80)).result()).isEqualTo(new BigDecimal("72.0"));
    assertThat(run(graph, Map.of("amount", 20)).result()).isEqualTo(new BigDecimal("20"));
    assertThat(run(graph, Map.of("amount", 100)).trace())
        .extracting(Engine.Step::nodeId)
        .containsExactly("input", "choose", "premium", "out");
    assertThat(run(graph, Map.of("amount", 100)).trace().get(1).branch()).isEqualTo("case:VIP");
    assertThat(new GraphPlan(graph).available().get("out")).contains("price");
  }

  @Test
  void caseOrderIsPriorityAndLaterExpressionsAreNotEvaluated() {
    String source = script.render(choice());
    var shortCircuit = script.parse(source.replace("amount >= 50", "1 / 0 > 1"));
    assertThat(run(shortCircuit, Map.of("amount", 100)).result()).isEqualTo(new BigDecimal("80.0"));
    assertThatThrownBy(() -> run(shortCircuit, Map.of("amount", 20)))
        .isInstanceOfSatisfying(
            ArcException.class,
            e -> {
              assertThat(e.getMessage()).contains("Case Standard", "Division by zero");
              assertThat(e.locations().getFirst().nodeId()).isEqualTo("choose");
            });
    var wrongType = script.parse(source.replace("amount >= 100", "amount"));
    assertThatThrownBy(() -> run(wrongType, Map.of("amount", 100)))
        .hasMessageContaining("Case Premium: Expected a boolean");
    var nodes =
        choice().nodes().stream()
            .map(
                n -> {
                  if (!n.type().equals("SWITCH")) return n;
                  return new Node(
                      n.id(),
                      n.type(),
                      n.label(),
                      n.position(),
                      null,
                      null,
                      null,
                      null,
                      null,
                      n.cases().reversed(),
                      null);
                })
            .toList();
    var reordered = new Definition(1, choice().inputs(), nodes, choice().edges());
    assertThat(run(reordered, Map.of("amount", 100)).result()).isEqualTo(new BigDecimal("90.0"));
  }

  @Test
  void selectedCaseCanFanOutAndJoinWithoutWaitingForOtherCases() {
    var graph =
        script.parse(
            """
        node input INPUT "Input" { next -> choose; }
        node choose SWITCH "Choose" {
          case yes "Yes" when true;
          case:yes -> a; case:yes -> b; default -> no;
        }
        node a FORMULA "A" { let a = 10; next -> sum; }
        node b FORMULA "B" { let b = 20; next -> sum; }
        node sum FORMULA "Sum" { let answer = a + b; next -> out; }
        node no FORMULA "No" { let answer = 1 / 0; next -> out; }
        node out OUTPUT "Output" { return answer; }
        """);
    assertThat(run(graph, Map.of()).result()).isEqualTo(new BigDecimal("30"));
    assertThat(new GraphPlan(graph).available().get("sum")).contains("a", "b");
    assertThat(new GraphPlan(graph).available().get("out"))
        .contains("answer")
        .doesNotContain("a", "b");
    var missing =
        script.parse(script.render(choice()).replace("let price = amount;", "let other = amount;"));
    assertThatThrownBy(() -> run(missing, Map.of("amount", 100)))
        .hasMessageContaining("unavailable");
  }

  @Test
  void completeSwitchRequiresEveryCaseDefaultAndStableUniqueIds() {
    var source = script.render(choice());
    var missing = script.parse(source.replaceAll("(?m)^  default ->.*\\n", ""));
    assertThatThrownBy(() -> validator.validate(missing, noRefs)).hasMessageContaining("default");
    var stale = script.parse(source.replace("case:VIP ->", "case:missing ->"));
    assertThatThrownBy(() -> validator.validate(stale, noRefs)).hasMessageContaining("connect");
    assertThat(script.build(source.replace("case \"standard\"", "case \"VIP\"")).diagnostics())
        .isNotEmpty();
  }

  private Definition transformation() {
    return script.parse(
        """
        inputs { customer: OBJECT required; items: ARRAY required; }
        node input INPUT "Input" { next -> normalize; }
        node normalize TRANSFORM "Normalize" {
          field "displayName" = $UPPER($TRIM(customer.name));
          field "amount" = $TO_NUMBER(customer.amount);
          field "country" = $COALESCE(customer.country, "US");
          field "items" = $MAP($FILTER(items, item, item.active), item, $OBJECT("sku", item.sku, "price", $ROUND($TO_NUMBER(item.price), 2)));
          field "optional" = null;
          as normalized;
          next -> out;
        }
        node out OUTPUT "Output" { return normalized; }
        """);
  }

  @Test
  void transformsCleanConvertMapAndAssembleWithoutMutatingInputs() {
    var customer = Map.of("name", "  alice  ", "amount", "9007199254740993.25");
    var items =
        List.of(
            Map.of("active", true, "sku", "a", "price", "12.555"),
            Map.of("active", false, "sku", "b", "price", "invalid"));
    var result =
        (Map<?, ?>) run(transformation(), Map.of("customer", customer, "items", items)).result();
    assertThat(result.get("displayName")).isEqualTo("ALICE");
    assertThat(result.get("amount")).isEqualTo(new BigDecimal("9007199254740993.25"));
    assertThat(result.get("country")).isEqualTo("US");
    assertThat(result.get("items"))
        .isEqualTo(List.of(Map.of("sku", "a", "price", new BigDecimal("12.56"))));
    assertThat(result.containsKey("optional")).isTrue();
    assertThat(result.get("optional")).isNull();
    assertThat(customer.get("name")).isEqualTo("  alice  ");
    var bad =
        Map.<String, Object>of(
            "customer", Map.of("name", "A", "amount", "bad"), "items", List.of());
    assertThatThrownBy(() -> run(transformation(), bad))
        .hasMessageContaining("Field amount: TO_NUMBER");
  }

  @Test
  void wholeTransformExpressionsReturnArraysAndWorkAsReusableRules() {
    var graph =
        script.parse(
            """
        inputs { values: ARRAY required; }
        node input INPUT "Input" { next -> convert; }
        node convert TRANSFORM "Convert" { let mapped = $MAP(values, value, $TO_NUMBER(value)); next -> out; }
        node out OUTPUT "Output" { return mapped; }
        """);
    assertThat(run(graph, Map.of("values", List.of("1.25", "2"))).result())
        .isEqualTo(List.of(new BigDecimal("1.25"), new BigDecimal("2")));
    var parent =
        script.parse(
            """
        node input INPUT "Input" { next -> reuse; }
        node reuse REFERENCE "Normalize values" { use "normalizer" version 1; bind values = ["1.25", "2"]; as items; next -> out; }
        node out OUTPUT "Output" { return $SUM(items); }
        """);
    assertThat(engine.execute("parent", 1, parent, Map.of(), (id, v) -> graph).result())
        .isEqualTo(new BigDecimal("3.25"));
  }

  @Test
  void scriptAndNodeEditingRoundTripCasesFieldNamesEdgeIdsAndPositions() throws Exception {
    for (var graph : List.of(choice(), transformation())) {
      assertThat(script.build(script.render(graph)).definition()).isEqualTo(graph);
      for (Node node : graph.nodes()) {
        var rebuilt = script.buildNode(graph, node.id(), script.renderNode(graph, node.id()));
        assertThat(rebuilt.diagnostics()).isEmpty();
        assertThat(rebuilt.definition().nodes()).isEqualTo(graph.nodes());
        assertThat(rebuilt.definition().edges()).containsExactlyInAnyOrderElementsOf(graph.edges());
      }
      var json = new ObjectMapper();
      assertThat(json.readValue(json.writeValueAsString(graph), Definition.class)).isEqualTo(graph);
    }
    assertThat(
            script
                .build("node transform TRANSFORM \"T\" { field \"x\" = 1; let data = $OBJECT(); }")
                .diagnostics())
        .isNotEmpty();
    assertThat(
            script
                .build("node transform TRANSFORM \"T\" { field \"x\" = 1; field \"x\" = 2; }")
                .diagnostics())
        .isNotEmpty();
    var bad = script.checkExpression("$MAP(items, item, item.price + factor)");
    assertThat(bad.valid()).isTrue();
    assertThat(bad.variables()).containsExactlyInAnyOrder("items", "factor");
    assertThat(script.checkExpression("$SUM(1 +)").valid()).isFalse();
  }

  @Test
  void transformFieldsCannotReadSiblingsAndDiagnosticsLocateBadCasesAndMappings() {
    var source =
        script.render(transformation()).replace("$TO_NUMBER(customer.amount)", "displayName");
    var graph = script.parse(source);
    assertThat(validator.diagnostics(graph, noRefs))
        .anySatisfy(
            problem -> {
              assertThat(problem.message()).contains("Field amount", "displayName");
              assertThat(problem.locations().getFirst().nodeId()).isEqualTo("normalize");
            });
    var invalid = script.parse(script.render(choice()).replace("amount >= 50", "missing >= 50"));
    assertThat(validator.diagnostics(invalid, noRefs))
        .anySatisfy(
            problem -> {
              assertThat(problem.message()).contains("Case Standard", "missing");
              assertThat(problem.locations().getFirst().nodeId()).isEqualTo("choose");
            });
  }

  @Test
  void dataFunctionsHaveExplicitNullTypeDuplicateAndMergeSemantics() {
    assertThat(Expressions.evaluate("$COALESCE(null, false, 1 / 0)", Map.of())).isEqualTo(false);
    assertThat(Expressions.evaluate("$COALESCE(null, \"\", \"fallback\")", Map.of())).isEqualTo("");
    assertThat(Expressions.evaluate("$TO_NUMBER(null)", Map.of())).isNull();
    assertThat(Expressions.evaluate("$TO_BOOLEAN(\" FALSE \")", Map.of())).isEqualTo(false);
    assertThat(Expressions.evaluate("$TO_STRING(12.50)", Map.of())).isEqualTo("12.50");
    assertThat(
            Expressions.evaluate(
                "$MERGE($OBJECT(\"a\", 1), $OBJECT(\"a\", 2, \"b\", true))", Map.of()))
        .isEqualTo(Map.of("a", new BigDecimal("2"), "b", true));
    assertThatThrownBy(() -> Expressions.compile("$OBJECT(\"a\")"))
        .hasMessageContaining("key/value");
    assertThatThrownBy(() -> Expressions.evaluate("$OBJECT(\"a\", null, \"a\", 2)", Map.of()))
        .hasMessageContaining("Duplicate");
    assertThatThrownBy(() -> Expressions.evaluate("$TO_BOOLEAN(1)", Map.of()))
        .hasMessageContaining("TO_BOOLEAN");
    assertThatThrownBy(() -> Expressions.evaluate("$TO_NUMBER(\"1e1000\")", Map.of()))
        .hasMessageContaining("precision");
  }
}
