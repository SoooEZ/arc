package dev.arc.engine.table;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.DecisionTable;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** The test grammar of a condition cell and the rows each policy selects. */
class DecisionTablesTest {
  private static boolean holds(String cell, Object value) {
    return DecisionTables.test(cell).holds(value);
  }

  @Test
  void valuesMatchByArcEqualityAndNotEqualByItsOpposite() {
    assertThat(holds("-", null)).isTrue();
    assertThat(holds(" - ", "anything")).isTrue();
    assertThat(holds("\"gold\"", "gold")).isTrue();
    assertThat(holds("'gold'", "gold")).isTrue();
    assertThat(holds("\"gold\"", "Gold")).isFalse();
    assertThat(holds("100", new BigDecimal("100.0"))).isTrue();
    assertThat(holds("1e2", 100)).isTrue();
    assertThat(holds("-5", new BigDecimal("-5"))).isTrue();
    assertThat(holds(".5", new BigDecimal("0.50"))).isTrue();
    assertThat(holds("100", "100")).as("types stay distinct").isFalse();
    assertThat(holds("true", true)).isTrue();
    assertThat(holds("false", true)).isFalse();
    assertThat(holds("null", null)).isTrue();
    assertThat(holds("null", 0)).isFalse();
    assertThat(holds("\"\"", "")).isTrue();
    assertThat(holds("\"a\\\"b\"", "a\"b")).as("ARC escapes").isTrue();
    assertThat(holds("!= \"gold\"", "silver")).isTrue();
    assertThat(holds("!= \"gold\"", "gold")).isFalse();
    assertThat(holds("!= 5", "x")).as("other types are never equal").isTrue();
    assertThat(holds("!= 5", null)).isTrue();
    assertThat(holds("!= null", 0)).isTrue();
    assertThat(holds("!= null", null)).isFalse();
  }

  @Test
  void comparisonsAndRangesTakeNumbersAndNeverHoldForNull() {
    assertThat(holds(">= 100", new BigDecimal("100"))).isTrue();
    assertThat(holds(">100", new BigDecimal("100"))).isFalse();
    assertThat(holds("< -5", new BigDecimal("-6"))).isTrue();
    assertThat(holds("<= 0.5", new BigDecimal("0.50"))).isTrue();
    assertThat(holds("< 100", null)).isFalse();
    assertThat(holds("10..20", 10)).isTrue();
    assertThat(holds("10..20", 20)).isTrue();
    assertThat(holds("10..<20", 20)).isFalse();
    assertThat(holds("10..<20", new BigDecimal("19.99"))).isTrue();
    assertThat(holds("10<..20", 10)).isFalse();
    assertThat(holds("10<..<20", new BigDecimal("10.5"))).isTrue();
    assertThat(holds("10<..<20", 20)).isFalse();
    assertThat(holds("-10..-5", -7)).isTrue();
    assertThat(holds("5..5", 5)).isTrue();
    assertThat(holds("0.5..1.5", new BigDecimal("1"))).isTrue();
    assertThat(holds("1e2..2e2", 150)).isTrue();
    assertThat(holds("10..20", null)).isFalse();
    assertThatThrownBy(() -> holds("> 1", "2")).isInstanceOf(CellTest.Mismatch.class);
    assertThatThrownBy(() -> holds("1..2", true)).isInstanceOf(CellTest.Mismatch.class);
  }

  @Test
  void listsHoldWhenOneTestDoesAndNotWhenNoneDoes() {
    assertThat(holds("\"gold\", \"silver\"", "silver")).isTrue();
    assertThat(holds("\"gold\", \"silver\"", "bronze")).isFalse();
    assertThat(holds("< 0, > 100", 150)).isTrue();
    assertThat(holds("1, 10..20", 15)).isTrue();
    assertThat(holds("not(\"gold\", \"silver\")", "bronze")).isTrue();
    assertThat(holds("not(\"gold\")", "gold")).isFalse();
    assertThat(holds("not(\"gold\")", null)).as("null is not gold").isTrue();
    assertThat(holds("not( 1..5 )", 7)).isTrue();
    assertThat(holds("\"a,b\", \"c\"", "a,b")).as("a comma in text").isTrue();
  }

  @Test
  void aCellThatIsNotATestSaysWhatATestCanBe() {
    String grammar =
        " is not a test. Write a value (\"gold\", 100, true or null), a comparison"
            + " (>= 100 or != \"gold\"), a range (10..20 or 10..<20), a list (\"a\", \"b\"),"
            + " not(…) or - for any value";
    for (String cell :
        List.of(
            ">= abc x",
            "= 100",
            "5 < 6",
            "1, ",
            "\"a\" \"b\"",
            "not(\"a\"",
            "not(\"a\") , 1",
            "- 5",
            "-, 1",
            "[1..5)",
            "$X",
            "1..",
            "5.."))
      assertThatThrownBy(() -> DecisionTables.test(cell))
          .as(cell)
          .isInstanceOf(ArcException.class)
          .satisfies(
              error ->
                  assertThat(error.getMessage())
                      .as(cell)
                      .isIn(
                          "\"" + cell.trim() + "\"" + grammar,
                          "Write text in quotes: \"X\"; a test cannot read a variable",
                          "\"" + cell.trim() + "\" has a quote that is never closed"));
    assertThatThrownBy(() -> DecisionTables.test("gold"))
        .hasMessage("Write text in quotes: \"gold\"; a test cannot read a variable");
    assertThatThrownBy(() -> DecisionTables.test("\"gold\", silver"))
        .hasMessage("Write text in quotes: \"silver\"; a test cannot read a variable");
    assertThatThrownBy(() -> DecisionTables.test("TRUE"))
        .hasMessage("Write text in quotes: \"TRUE\"; a test cannot read a variable");
    assertThatThrownBy(() -> DecisionTables.test("> \"gold\""))
        .hasMessage(
            "Comparisons and ranges take numbers; test text with \"text\", != \"text\" or not(…)");
    assertThatThrownBy(() -> DecisionTables.test(" "))
        .hasMessage("Enter a test, or - for any value");
    assertThatThrownBy(() -> DecisionTables.test("\"open"))
        .hasMessage("\"\"open\" has a quote that is never closed");
    assertThatThrownBy(() -> DecisionTables.test("20..10"))
        .hasMessage("\"20..10\" is an empty range; write the smaller number first");
    assertThatThrownBy(() -> DecisionTables.test("5..<5"))
        .hasMessage("\"5..<5\" holds no number; write 5 for that value");
    assertThatThrownBy(() -> DecisionTables.test("1e101"))
        .hasMessage("Number exceeds supported precision or magnitude");
    assertThatThrownBy(() -> DecisionTables.test("x".repeat(2_001)))
        .hasMessage("Test exceeds 2,000 characters");
    String long_ = "\"" + "a".repeat(60) + "\" x";
    assertThatThrownBy(() -> DecisionTables.test(long_))
        .hasMessageStartingWith("\"" + long_.substring(0, 40) + "…\" is not a test.");
  }

  /** Lesson B13: the scan is a loop, so a long string fits a small stack. */
  @Test
  void aLongStringLiteralParsesOnASmallStack() throws Exception {
    String text = "a\\\"".repeat(600);
    String cell = "not(\"" + text + "\", \"" + "b".repeat(150) + "\")";
    var parsed = new AtomicReference<Object>();
    var thread = new Thread(null, () -> parsed.set(DecisionTables.test(cell)), "small", 256 * 1024);
    thread.start();
    thread.join();
    assertThat(parsed.get()).isInstanceOf(CellTest.NoneOf.class);
    assertThat(((CellTest) parsed.get()).holds("a\"".repeat(600))).isFalse();
  }

  @Test
  void literalsKeepTheirTypesForTheOneTypePerColumnRule() {
    assertThat(DecisionTables.test("\"a\", 1..2, true, null").literals())
        .extracting(DecisionTables::typeOf)
        .containsExactly(
            DecisionTables.LiteralType.TEXT,
            DecisionTables.LiteralType.NUMBER,
            DecisionTables.LiteralType.NUMBER,
            DecisionTables.LiteralType.BOOLEAN,
            null);
    assertThat(DecisionTables.described(new BigDecimal("100"))).isEqualTo("the number 100");
    assertThat(DecisionTables.described("gold")).isEqualTo("the text \"gold\"");
    assertThat(DecisionTables.described(true)).isEqualTo("the boolean true");
    assertThat(DecisionTables.described(null)).isEqualTo("null");
  }

  private static DecisionTables.Compiled table(String policy, List<List<String>> rows) {
    int columns = rows.getFirst().size();
    var conditions = new ArrayList<DecisionTable.Condition>();
    for (int column = 0; column < columns; column++)
      conditions.add(new DecisionTable.Condition(List.of("Tier", "Amount").get(column), "x"));
    var tableRows = new ArrayList<DecisionTable.Row>();
    var tests = new ArrayList<List<CellTest>>();
    for (List<String> row : rows) {
      tableRows.add(new DecisionTable.Row(row, List.of("1")));
      tests.add(row.stream().map(DecisionTables::test).toList());
    }
    var definition =
        new DecisionTable(
            policy, conditions, List.of(new DecisionTable.Result("value")), tableRows);
    return DecisionTables.compile(definition, tests);
  }

  private static final List<List<String>> TIERS =
      List.of(
          List.of("\"gold\"", "-"),
          List.of("-", ">= 100"),
          List.of("-", "< 100"),
          List.of("\"gold\"", ">= 500"));

  @Test
  void firstStopsAtTheFirstMatchUniqueChecksEveryRowCollectKeepsThemAll() {
    assertThat(table("FIRST", TIERS).select(values("gold", 600))).containsExactly(0);
    assertThat(table(null, TIERS).select(values("silver", 50))).containsExactly(2);
    assertThat(table("COLLECT", TIERS).select(values("gold", 600))).containsExactly(0, 1, 3);
    assertThat(table("COLLECT", TIERS).select(values("silver", null))).isEmpty();
    assertThat(table("UNIQUE", TIERS).select(values("silver", 150))).containsExactly(1);
    assertThatThrownBy(() -> table("UNIQUE", TIERS).select(values("gold", 150)))
        .isInstanceOf(ArcException.class)
        .hasMessage(
            "Rows 1 and 2 both match Tier \"gold\", Amount 150; with one match only, rows must"
                + " not overlap");
    assertThatThrownBy(() -> table("UNIQUE", TIERS).select(values("gold", 600)))
        .hasMessage(
            "Rows 1, 2 and 4 match Tier \"gold\", Amount 600; with one match only, rows must not"
                + " overlap");
    assertThatThrownBy(() -> table("FIRST", TIERS).select(values("silver", null)))
        .hasMessage("No row matches Tier \"silver\", Amount null");
    assertThatThrownBy(() -> table("UNIQUE", TIERS).select(values("silver", null)))
        .hasMessage("No row matches Tier \"silver\", Amount null");
  }

  @Test
  void aValueAnOrderingTestCannotCompareFailsNamingItsColumnAndRow() {
    assertThatThrownBy(() -> table("FIRST", TIERS).select(values("silver", "abc")))
        .isInstanceOf(ArcException.class)
        .hasMessage("Amount is text (\"abc\"), but row 2 compares it with a number");
    assertThatThrownBy(() -> table("FIRST", TIERS).select(values("silver", true)))
        .hasMessage("Amount is a boolean (true), but row 2 compares it with a number");
    // The first row's Tier test fails before its Amount test is reached.
    assertThat(table("FIRST", List.of(List.of("\"gold\"", "> 1"), List.of("-", "-"))))
        .satisfies(table -> assertThat(table.select(values("silver", "x"))).containsExactly(1));
    assertThatThrownBy(() -> table("FIRST", TIERS).select(values(List.of(1), 1)))
        .hasMessage(
            "Tier is an array; a decision table compares numbers, text, true/false or null");
    assertThatThrownBy(() -> table("FIRST", TIERS).select(values("gold", Map.of("a", 1))))
        .hasMessage(
            "Amount is an object; a decision table compares numbers, text, true/false or null");
  }

  @Test
  void messagesQuoteTextAndCutLongValues() {
    var table = table("FIRST", List.of(List.of("\"gold\"", "-")));
    assertThatThrownBy(() -> table.select(values("say \"hi\" \\ " + "x".repeat(60), 1.5)))
        .hasMessage(
            "No row matches Tier \"say \\\"hi\\\" \\\\ " + "x".repeat(26) + "…\", Amount 1.5");
  }

  private static List<Object> values(Object... values) {
    return Arrays.asList(values);
  }
}
