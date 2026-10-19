package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.script.ScriptParsing;
import dev.arc.engine.validation.RuleCalls;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.support.Engines;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** A decision table node from validation to execution and its trace. */
class DecisionTableTest {
  private final Validator validator = new Validator();
  private final RuleResolver noRefs =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  /** Shipping: Input, a table whose value the Output returns, with this node body. */
  private static Definition shipping(String body) {
    return ScriptParsing.parse(
        """
        inputs {
          tier: STRING required;
          amount: NUMBER optional;
          region: STRING required default "domestic";
        }
        node input INPUT "Input" { next -> fee; }
        node fee DECISION_TABLE "Shipping fee" {
        %s
          next -> out;
        }
        node out OUTPUT "Output" { return shipping; }
        """
            .formatted(body));
  }

  private static final String FEES =
      """
        condition "Tier" = tier;
        condition "Order amount" = amount;
        condition "Region" = region;
        result fee;
        row "gold" | - | "domestic" -> 0;
        row - | >= 100 | "domestic" -> 0;
        row - | < 100 | "domestic" -> 8;
        row - | - | "overseas" -> 25;
        as shipping;
      """;

  private Engine.Result run(Definition definition, Map<String, Object> inputs) {
    return Engines.execute(validator, "shipping", 1, definition, inputs, noRefs);
  }

  private static Map<String, Object> order(String tier, Object amount, String region) {
    var inputs = new LinkedHashMap<String, Object>();
    inputs.put("tier", tier);
    inputs.put("amount", amount);
    inputs.put("region", region);
    return inputs;
  }

  @Test
  void theFirstMatchingRowGivesTheValueAndTheTraceNamesIt() {
    var graph = shipping(FEES);
    var gold = run(graph, order("gold", new BigDecimal("20"), "domestic"));
    assertThat(gold.result()).isEqualTo(new BigDecimal("0"));
    var step = gold.trace().get(1);
    assertThat(step.nodeId()).isEqualTo("fee");
    assertThat(step.branch()).isEqualTo("next");
    assertThat(step.matchedRows()).containsExactly(1);
    assertThat(run(graph, order("silver", new BigDecimal("150"), "domestic")).result())
        .isEqualTo(new BigDecimal("0"));
    var small = run(graph, order("silver", new BigDecimal("50"), "domestic"));
    assertThat(small.result()).isEqualTo(new BigDecimal("8"));
    assertThat(small.trace().get(1).matchedRows()).containsExactly(3);
    assertThat(run(graph, order("silver", null, "overseas")).result())
        .isEqualTo(new BigDecimal("25"));
    // Other steps carry no matched rows.
    assertThat(small.trace().get(0).matchedRows()).isNull();
    assertThat(new GraphPlan(graph).available().get("out")).contains("shipping");
  }

  @Test
  void noMatchingRowFailsAtTheNodeNamingEveryValue() {
    var graph = shipping(FEES);
    assertThatThrownBy(() -> run(graph, order("silver", null, "domestic")))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.locations())
                  .extracting(ArcException.Location::nodeId)
                  .containsExactly("fee");
            })
        .hasMessage("No row matches Tier \"silver\", Order amount null, Region \"domestic\"");
    assertThatThrownBy(() -> run(graph, order("silver", "50", "domestic")))
        .as("an input checks its own type first")
        .isInstanceOf(ArcException.class);
  }

  @Test
  void uniqueRefusesOverlappingRowsAtRunTimeAndCollectListsEveryMatch() {
    var unique = shipping("  hit unique;\n" + FEES);
    assertThat(run(unique, order("silver", new BigDecimal("50"), "domestic")).result())
        .isEqualTo(new BigDecimal("8"));
    assertThatThrownBy(() -> run(unique, order("gold", new BigDecimal("150"), "domestic")))
        .hasMessage(
            "Rows 1 and 2 both match Tier \"gold\", Order amount 150, Region \"domestic\"; with"
                + " one match only, rows must not overlap");
    var collect = shipping("  hit collect;\n" + FEES);
    var all = run(collect, order("gold", new BigDecimal("150"), "domestic"));
    assertThat(all.result()).isEqualTo(List.of(new BigDecimal("0"), new BigDecimal("0")));
    assertThat(all.trace().get(1).matchedRows()).containsExactly(1, 2);
    var none = run(collect, order("silver", null, "domestic"));
    assertThat(none.result()).isEqualTo(List.of());
    assertThat(none.trace().get(1).matchedRows()).isEmpty();
  }

  @Test
  void severalResultsMakeAnObjectAndOnlyMatchedRowsAreEvaluated() {
    var graph =
        shipping(
            """
              condition "Order amount" = amount;
              result fee;
              result carrier;
              row >= 100 -> 0 | "post";
              row - -> 1 / 0 | "never";
              as shipping;
            """);
    // Row 2's result would divide by zero; it is never evaluated for a large order.
    var result = run(graph, order("x", new BigDecimal("150"), "domestic")).result();
    assertThat(result).isEqualTo(Map.of("fee", new BigDecimal("0"), "carrier", "post"));
    assertThat(new ArrayList<Object>(((Map<?, ?>) result).keySet()))
        .containsExactly("fee", "carrier");
    assertThatThrownBy(() -> run(graph, order("x", new BigDecimal("50"), "domestic")))
        .hasMessage("Row 2 / Result fee: Division by zero");
  }

  @Test
  void conditionValuesAreScalarsAndOrderingTestsNeedNumbers() {
    var graph =
        ScriptParsing.parse(
            """
            inputs { data: OBJECT required; }
            node input INPUT "Input" { next -> pick; }
            node pick DECISION_TABLE "Pick" {
              condition "Value" = data.value;
              result picked;
              row >= 1 -> "big";
              row - -> "other";
              as picked;
              next -> out;
            }
            node out OUTPUT "Output" { return picked; }
            """);
    assertThat(
            Engines.execute(validator, "pick", 1, graph, Map.of("data", Map.of("value", 2)), noRefs)
                .result())
        .isEqualTo("big");
    assertThatThrownBy(
            () ->
                Engines.execute(
                    validator, "pick", 1, graph, Map.of("data", Map.of("value", "2")), noRefs))
        .hasMessage("Value is text (\"2\"), but row 1 compares it with a number");
    assertThatThrownBy(
            () ->
                Engines.execute(
                    validator,
                    "pick",
                    1,
                    graph,
                    Map.of("data", Map.of("value", List.of())),
                    noRefs))
        .hasMessage(
            "Value is an array; a decision table compares numbers, text, true/false or null");
    // A condition expression's own failure is named by its column.
    assertThatThrownBy(
            () ->
                Engines.execute(
                    validator,
                    "pick",
                    1,
                    shippingWithCondition("1 / 0"),
                    order("gold", BigDecimal.ONE, "domestic"),
                    noRefs))
        .hasMessage("Condition Broken: Division by zero");
  }

  private static Definition shippingWithCondition(String expression) {
    return shipping(
        """
          condition "Broken" = %s;
          result fee;
          row - -> 1;
          as shipping;
        """
            .formatted(expression));
  }

  /** Every problem of an unfinished table, at its position, as diagnostics list them. */
  @Test
  void validationNamesEachProblemByItsCell() {
    assertProblem(shipping("  as shipping;"), "Shipping fee: add at least one condition");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  as shipping;"),
        "Shipping fee: add at least one result");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  result fee;\n  as shipping;"),
        "Shipping fee: add at least one row");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  result;\n  row - -> 1;\n  as shipping;"),
        "Shipping fee / Result 1: name this result");
    assertProblem(
        shipping("  condition \"Tier\" =;\n  result fee;\n  row - -> 1;\n  as shipping;"),
        "Shipping fee / Condition Tier: Expression is required");
    assertProblem(
        shipping("  condition \"Tier\" = missing;\n  result fee;\n  row - -> 1;\n  as shipping;"),
        "Shipping fee / Condition Tier: uses missing, which no input or result variable provides;"
            + " correct the name or add an input named missing");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  result fee;\n  row - -> ;\n  as shipping;"),
        "Shipping fee / Row 1 / Result fee: Expression is required");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  result fee;\n  row  -> 1;\n  as shipping;"),
        "Shipping fee / Row 1 / Condition Tier: Enter a test, or - for any value");
    assertProblem(
        shipping(
            "  condition \"Tier\" = tier;\n  result fee;\n  row \"gold\" -> 1;\n"
                + "  row > 5 -> 2;\n  as shipping;"),
        "Shipping fee / Row 2 / Condition Tier: tests the number 5, but row 1 tests the text"
            + " \"gold\"; a column tests one type of value");
    assertProblem(
        shipping(
            "  condition \"Tier\" = tier;\n  result fee;\n  row \"gold\", true -> 1;\n"
                + "  as shipping;"),
        "Shipping fee / Row 1 / Condition Tier: tests the boolean true and the text \"gold\"; a"
            + " column tests one type of value");
    assertProblem(
        shipping("  condition \"Tier\" = tier;\n  result fee;\n  row null -> 1;\n  as tier;"),
        "Shipping fee: its result variable tier has the name of an input; choose another name");
  }

  private void assertProblem(Definition definition, String message) {
    assertThat(validator.diagnose(definition, noRefs).problems())
        .extracting(Validator.Problem::message)
        .contains(message);
    assertThatThrownBy(() -> validator.validate(definition, noRefs)).hasMessage(message);
  }

  @Test
  void aTestCellThatIsNotATestIsAValidationProblemInAJsonDraft() {
    var draft =
        shipping("  condition \"Tier\" = tier;\n  result fee;\n  row - -> 1;\n  as shipping;");
    var nodes = new ArrayList<>(draft.nodes());
    var fee = nodes.get(1);
    var table = fee.table();
    var broken =
        new Definition.DecisionTable(
            table.hitPolicy(),
            table.conditions(),
            table.results(),
            List.of(new Definition.DecisionTable.Row(List.of("gold"), List.of("1"))));
    nodes.set(1, dev.arc.support.GraphFixtures.copyOf(fee).table(broken).build());
    var stored = new Definition(1, draft.inputs(), nodes, draft.edges());
    validator.shape(stored);
    assertThat(validator.diagnose(stored, noRefs).problems())
        .extracting(Validator.Problem::message)
        .containsExactly(
            "Shipping fee / Row 1 / Condition Tier: Write text in quotes: \"gold\"; a test cannot"
                + " read a variable");
  }

  @Test
  void callsInsideATableAreTheTablesCallees() {
    var graph =
        shipping(
            """
              condition "Tier" = @tier-of:2(tier);
              result fee;
              row - -> @fee-of:3(amount);
              as shipping;
            """);
    assertThat(RuleCalls.calledRuleIds(graph)).containsExactlyInAnyOrder("tier-of", "fee-of");
  }

  @Test
  void theResultSerializesItsMatchedRowsOnlyForTables() throws Exception {
    var json = Engines.PLAIN;
    var result = run(shipping(FEES), order("silver", new BigDecimal("50"), "domestic"));
    String trace = json.writeValueAsString(result.trace());
    assertThat(trace)
        .contains("\"branch\":\"next\",\"matchedRows\":[3],\"depth\":0")
        .doesNotContain("\"matchedRows\":null");
    assertThat(new ObjectMapper().writeValueAsString(result.trace().get(0)))
        .doesNotContain("matchedRows");
  }
}
