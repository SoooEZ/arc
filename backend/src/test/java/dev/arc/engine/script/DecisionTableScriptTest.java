package dev.arc.engine.script;

import static dev.arc.support.GraphFixtures.copyOf;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.DecisionTable;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A decision table in ARC Script: its statements, their problems and what render refuses. */
class DecisionTableScriptTest {
  private final ArcScript script = new ArcScript(new ObjectMapper(), new Validator());

  private static String table(String body) {
    return """
        inputs { tier: STRING required; amount: NUMBER optional; }
        node input INPUT "Input" { next -> fee; }
        node fee DECISION_TABLE "Fee" {
        %s
          next -> out;
        }
        node out OUTPUT "Out" { return shipping; }
        """
        .formatted(body);
  }

  private ArcScript.Diagnostic problem(String body) {
    var built = script.build(table(body));
    assertThat(built.definition()).as(body).isNull();
    assertThat(built.diagnostics()).as(body).hasSize(1);
    return built.diagnostics().getFirst();
  }

  @Test
  void eachStatementBuildsItsPartOfTheTable() {
    var built =
        script.build(
            table(
                """
                  hit collect;
                  condition "Tier" = tier;
                  condition "Amount, in €" = amount;
                  result fee;
                  result note;
                  row "gold", 'silver' | 10..<100 -> amount * 0.1 | "a|b";
                  row not("gold") | - -> 0 | $CONCAT("x", "->") || false;
                  as shipping;
                """));
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.definition().nodes().get(1).table())
        .isEqualTo(
            new DecisionTable(
                "COLLECT",
                List.of(
                    new DecisionTable.Condition("Tier", "tier"),
                    new DecisionTable.Condition("Amount, in €", "amount")),
                List.of(new DecisionTable.Result("fee"), new DecisionTable.Result("note")),
                List.of(
                    new DecisionTable.Row(
                        List.of("\"gold\", 'silver'", "10..<100"),
                        List.of("amount * 0.1", "\"a|b\"")),
                    new DecisionTable.Row(
                        List.of("not(\"gold\")", "-"),
                        List.of("0", "$CONCAT(\"x\", \"->\") || false")))));
    assertThat(built.definition().nodes().get(1).output()).isEqualTo("shipping");
    assertThat(script.build(built.source()).definition()).isEqualTo(built.definition());
  }

  @Test
  void problemsPointAtTheStatementThatCausedThem() {
    assertThat(problem("  hit sometimes;"))
        .isEqualTo(new ArcScript.Diagnostic("Use: hit first; hit unique; or hit collect;", 4, 3));
    assertThat(problem("  hit first;\n  hit unique;"))
        .isEqualTo(new ArcScript.Diagnostic("Duplicate statement: hit", 5, 3));
    assertThat(problem("  condition Tier = tier;"))
        .isEqualTo(new ArcScript.Diagnostic("Use: condition \"Label\" = expression;", 4, 3));
    assertThat(problem("  result 1fee;").message()).startsWith("Names must be identifiers");
    assertThat(problem("  result fee;\n  row - 1;"))
        .isEqualTo(new ArcScript.Diagnostic("Use: row test | test -> result | result;", 5, 3));
    assertThat(problem("  condition \"Tier\" = tier;\n  result fee;\n  row gold -> 1;"))
        .isEqualTo(
            new ArcScript.Diagnostic(
                "Write text in quotes: \"gold\"; a test cannot read a variable", 6, 3));
    assertThat(problem("  condition \"Tier\" = tier;\n  result fee;\n  row - -> 1 +;").line())
        .isEqualTo(6);
    // Draft-shape problems point at the element's statement too.
    assertThat(
            problem("  condition \"Tier\" = tier;\n  condition \"Tier\" = amount;\n  result fee;"))
        .isEqualTo(
            new ArcScript.Diagnostic("Conditions need unique labels of 1 to 160 characters", 5, 3));
    assertThat(problem("  condition \"Tier\" = tier;\n  result fee;\n  result fee;"))
        .isEqualTo(
            new ArcScript.Diagnostic(
                "Results need unique names: letters, digits and underscores, starting with a"
                    + " letter or underscore",
                6,
                3));
    assertThat(
            problem(
                "  condition \"Tier\" = tier;\n  condition \"Amount\" = amount;\n  result fee;\n"
                    + "  row - -> 1;"))
        .isEqualTo(
            new ArcScript.Diagnostic("Row 1 has 1 test, but the table has 2 conditions", 7, 3));
    assertThat(problem("  condition \"Tier\" = tier;\n  row - -> 1 | 2;"))
        .isEqualTo(
            new ArcScript.Diagnostic(
                "Row 1 has 2 results, but the table has 0 result columns", 5, 3));
  }

  @Test
  void aCellTheCodeCouldNotReadBackIsRefusedAtItsNode() {
    var built =
        script.build(
            table("  condition \"Tier\" = tier;\n  result fee;\n  row - -> 1;\n  as shipping;"));
    Definition draft = built.definition();
    for (List<String> row :
        List.of(
            List.of("\"a\" | \"b\"", "1"),
            List.of("-", "1 -> 2"),
            List.of("-", "1; as other"),
            List.of("-", "a | b"),
            List.of("(-", "1")))
      assertThatThrownBy(() -> script.render(withRow(draft, row)))
          .as(row.toString())
          .isInstanceOfSatisfying(
              ArcException.class,
              error ->
                  assertThat(error.locations())
                      .extracting(ArcException.Location::nodeId)
                      .containsExactly("fee"))
          .hasMessage(
              "Fee: ARC Script cannot show row 1, which has a cell with a ';', '}', '//', '|' or"
                  + " '->' outside quotes or an unclosed quote or bracket; correct it in the graph");
    var kept = withRow(draft, List.of("\"a|b\", \"->\"", "a || b"));
    assertThat(script.build(script.render(kept)).definition()).isEqualTo(kept);
  }

  @Test
  void aNodeFragmentReplacesTheTable() {
    Definition draft =
        script
            .build(
                table("  condition \"Tier\" = tier;\n  result fee;\n  row - -> 1;\n  as shipping;"))
            .definition();
    String fragment = script.renderNode(draft, "fee");
    assertThat(fragment)
        .contains(
            "  condition \"Tier\" = tier;\n  result fee;\n  row - -> 1;\n  as shipping;\n  next ->");
    var applied =
        script.buildNode(draft, "fee", fragment.replace("row - -> 1;", "row \"gold\" -> 2;"));
    assertThat(applied.diagnostics()).isEmpty();
    assertThat(applied.definition().nodes().get(1).table().rows())
        .containsExactly(new DecisionTable.Row(List.of("\"gold\""), List.of("2")));
  }

  private static Definition withRow(Definition draft, List<String> cells) {
    var nodes = new ArrayList<>(draft.nodes());
    var fee = nodes.get(1);
    var table = fee.table();
    nodes.set(
        1,
        copyOf(fee)
            .table(
                new DecisionTable(
                    table.hitPolicy(),
                    table.conditions(),
                    table.results(),
                    List.of(new DecisionTable.Row(List.of(cells.get(0)), List.of(cells.get(1))))))
            .build());
    return new Definition(1, draft.inputs(), nodes, draft.edges(), draft.notes());
  }
}
