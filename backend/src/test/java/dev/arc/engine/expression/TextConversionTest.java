package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** $CONCAT, $CONTAINS, $GET and $PLUCK read numbers as $TO_STRING writes them, never 2E+1. */
class TextConversionTest {
  private static final Map<String, Object> SCOPE = scope();

  private static Map<String, Object> scope() {
    var values = new HashMap<String, Object>();
    values.put("gross", new BigDecimal("1250"));
    values.put("nothing", null);
    values.put("letters", List.of("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"));
    var indexed = new ArrayList<Object>();
    for (int i = 0; i <= 10; i++) indexed.add("i" + i);
    values.put("arr", indexed);
    values.put("byYear", Map.of("2020", "found"));
    values.put("items", List.of(Map.of("10", "ten"), Map.of("10", "zehn")));
    return values;
  }

  private static Object eval(String expression) {
    return Expressions.evaluate(expression, SCOPE);
  }

  @Test
  void concatWritesNumbersInPlainDecimalNotation() {
    // Decimal division, negative rounding and exponent literals keep a negative scale.
    for (var sample :
        Map.of(
                "$CONCAT(\"Year \", $YEAR($DATE(2020, 1, 1)))", "Year 2020",
                "$CONCAT($YEAR($DATE(2020, 10, 20)), \"-\", $MONTH($DATE(2020, 10, 20)))",
                    "2020-10",
                "$CONCAT(\"Net: \", gross / 1.25)", "Net: 1000",
                "$CONCAT(\"Price: \", 100 / 0.5)", "Price: 200",
                "$CONCAT(\"Total \", $ROUND(1234.5, -2))", "Total 1200",
                "$CONCAT(\"n=\", 1e3)", "n=1000",
                "$CONCAT(\"eps=\", 0.0000001)", "eps=0.0000001",
                "$CONCAT(\"amount \", 20.50)", "amount 20.50")
            .entrySet())
      assertThat(eval(sample.getKey())).as(sample.getKey()).isEqualTo(sample.getValue());
  }

  @Test
  void concatJoinsScalarsAndArraysButNotObjects() {
    assertThat(eval("$CONCAT(\"a\", nothing, \"b\")")).isEqualTo("ab");
    assertThat(eval("$CONCAT([1, [2, 3]], true, \" \", null)")).isEqualTo("123true ");
    for (String expression : List.of("$CONCAT($OBJECT(\"a\", 1))", "$CONCAT([$OBJECT()], \"x\")"))
      assertThatThrownBy(() -> eval(expression))
          .as(expression)
          .isInstanceOf(ArcException.class)
          .hasMessage("CONCAT joins scalar values or arrays of scalars");
  }

  @Test
  void containsSearchesCanonicalTextAndNullIsNeverText() {
    assertThat(eval("$CONTAINS(\"Year 2020\", $YEAR($DATE(2020, 1, 1)))")).isEqualTo(true);
    assertThat(eval("$CONTAINS(\"price 1000\", 1e3)")).isEqualTo(true);
    // A null text used to be searched as the word "null".
    assertThat(eval("$CONTAINS(nothing, \"ul\")")).isEqualTo(false);
    assertThat(eval("$CONTAINS(\"annulled\", nothing)")).isEqualTo(false);
    assertThat(eval("$CONTAINS(nothing, nothing)")).isEqualTo(false);
    assertThat(eval("$CONTAINS([1, nothing], nothing)")).isEqualTo(true);
    assertThatThrownBy(() -> eval("$CONTAINS($OBJECT(\"a\", 1), \"a\")"))
        .hasMessage("CONTAINS searches text or an array");
    assertThatThrownBy(() -> eval("$CONTAINS(\"{a=1}\", $OBJECT(\"a\", 1))"))
        .hasMessage("CONTAINS can only search text for a scalar value");
  }

  @Test
  void numericPathsNameTheSameEntryHoweverTheNumberWasProduced() {
    assertThat(eval("$GET(arr, $MATCH(\"j\", letters, 0))")).isEqualTo("i10");
    assertThat(eval("$GET(arr, 10)")).isEqualTo("i10");
    assertThat(eval("$GET(arr, 1e1)")).isEqualTo("i10");
    assertThat(eval("$GET(arr, 10.0)")).isEqualTo("i10");
    assertThat(eval("$GET(byYear, $YEAR($DATE(2020, 1, 1)), \"none\")")).isEqualTo("found");
    assertThat(eval("$PLUCK(items, 5 * 2)")).isEqualTo(List.of("ten", "zehn"));
    assertThat(eval("$GET(arr, \"12\", \"none\")")).isEqualTo("none");
    // A missing path used to look up a field literally named "null".
    assertThatThrownBy(() -> eval("$GET(byYear, nothing)"))
        .hasMessage("GET needs a text or number path");
    assertThatThrownBy(() -> eval("$PLUCK(items, [\"10\"])"))
        .hasMessage("PLUCK needs a text or number path");
  }

  @Test
  void emptyPathSegmentsAndFractionalNumbersMissInsteadOfReadingAnotherEntry() {
    // "name." read the prefix, "." the whole object and 3 / 2 the nested grid[1][5] before.
    Map<String, Object> customer =
        Map.of("name", "Ada", "address", Map.of("city", "Paris"), "tier", "gold");
    Map<String, Object> scope =
        Map.of(
            "customer",
            customer,
            "grid",
            List.of(List.of(1, 2), List.of(10, 15, 20, 25, 30, 35)),
            "field",
            "");
    for (String path :
        List.of(
            "\"name.\"",
            "\".\"",
            "\"..\"",
            "\".name\"",
            "\"address..city\"",
            "$CONCAT(\"address.\", field)"))
      assertThat(Expressions.evaluate("$GET(customer, " + path + ", \"missing\")", scope))
          .as(path)
          .isEqualTo("missing");
    assertThat(Expressions.evaluate("$GET(grid, 3 / 2, \"missing\")", scope)).isEqualTo("missing");
    assertThat(Expressions.evaluate("$PLUCK([customer], \"tier.\", \"missing\")", scope))
        .isEqualTo(List.of("missing"));
    assertThat(Expressions.evaluate("$GET(customer, \"address.city\")", scope)).isEqualTo("Paris");
    assertThat(eval("$GET($OBJECT(\"1.5\", \"x\"), 1.5)")).isEqualTo("x");
    assertThat(
            Expressions.evaluate(
                "$GET(blank, \"\", \"missing\")", Map.of("blank", Map.of("", "empty"))))
        .isEqualTo("empty");
  }
}
