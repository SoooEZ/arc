package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** Arrays reach POI only as ranges, and POI's numbers come back as plain decimals. */
class ExcelArgumentsTest {
  private static Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  private static Object eval(String expression, Map<String, Object> scope) {
    return Expressions.evaluate(expression, scope);
  }

  @Test
  void arraysInSingleValueParametersAreRejectedInsteadOfUsingTheirFirstCell() {
    // POI evaluates at one fixed cell, so these used to return 2, 2, "A" and 3.
    for (var sample :
        Map.of(
                "$SQRT([4, 9])", "SQRT: argument 1",
                "$SQRT([[4, 9], [16, 25]])", "SQRT: argument 1",
                "$UPPER([\"a\", \"b\"])", "UPPER: argument 1",
                "$LEN([\"abc\", \"de\"])", "LEN: argument 1",
                "$MOD(5, [2])", "MOD: argument 2",
                "$COUNTIF([1, 2], [1])", "COUNTIF: argument 2",
                "$TEXT([1, 2], \"0\")", "TEXT: argument 1")
            .entrySet()) {
      assertThatThrownBy(() -> eval(sample.getKey()))
          .as(sample.getKey())
          .isInstanceOf(ArcException.class)
          .hasMessage(sample.getValue() + " must be a single value, not an array");
    }
    // Range parameters still take arrays.
    assertThat(eval("$COUNTIF([1, 2, 2], 2)")).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$SUMPRODUCT([1, 2], [3, 4])")).isEqualTo(new BigDecimal("11"));
    assertThat(eval("$INDEX([[1, 2], [3, 4]], 2, 1)")).isEqualTo(new BigDecimal("3"));
  }

  @Test
  void emptyArraysCountAsNothingOrFindNothing() {
    var empty = new HashMap<String, Object>();
    empty.put("items", List.of());
    // Each of these used to see one phantom blank cell and answer 1.
    for (String expression :
        List.of(
            "$ROWS(items)",
            "$COLUMNS([])",
            "$COUNTA(items)",
            "$COUNTBLANK(items)",
            "$COUNTIF(items, \"<>cancelled\")",
            "$COUNTIF(items, \"\")",
            "$SUMIF(items, \">0\")",
            "$SUMIF(items, \">0\", [1])"))
      assertThat(eval(expression, empty)).as(expression).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$COUNTA(items, 5, [\"x\"])", empty)).isEqualTo(new BigDecimal("2"));
    assertThatThrownBy(() -> eval("$MATCH(\"a\", items, 0)", empty))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo("MATCH: #N/A");
              assertThat(error.kind()).isEqualTo(ArcException.Kind.NOT_AVAILABLE);
            });
    assertThat(eval("$ISNA($VLOOKUP(\"a\", items, 2, false))", empty)).isEqualTo(true);
    assertThat(eval("$IFERROR($HLOOKUP(\"a\", items, 2, false), \"none\")", empty))
        .isEqualTo("none");
  }

  @Test
  void otherEmptyRangesAreRejectedWithoutAnswer() {
    for (String function : List.of("PRODUCT", "MEDIAN", "SUMPRODUCT", "TRANSPOSE")) {
      assertThatThrownBy(() -> eval("$" + function + "([])"))
          .as(function)
          .isInstanceOf(ArcException.class)
          .hasMessage(function + ": Excel ranges cannot be empty");
    }
    assertThatThrownBy(() -> eval("$INDEX([], 1)"))
        .hasMessage("INDEX: Excel ranges cannot be empty");
    assertThatThrownBy(() -> eval("$SUMIF([1], \">0\", [])"))
        .hasMessage("SUMIF: Excel ranges cannot be empty");
    assertThatThrownBy(() -> eval("$COUNTA([[]])"))
        .hasMessage("Excel ranges cannot contain empty rows");
  }

  @Test
  void poiNumbersNeverComeBackWithANegativeScale() {
    // POI calculates in doubles; stripped of trailing zeros, 20.0 used to become 2E+1.
    var letters =
        Map.<String, Object>of(
            "letters", List.of("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"));
    for (var sample :
        Map.of(
                "$VLOOKUP(2, [[1, 10], [2, 20]], 2, false)", "20",
                "$YEAR($DATE(2020, 1, 1))", "2020",
                "$MATCH(\"j\", letters, 0)", "10",
                "$POWER(10, 3)", "1000",
                "$ABS($INT(-1200))", "1200",
                "$POWER(10, 100)", "1" + "0".repeat(100))
            .entrySet()) {
      Object value = eval(sample.getKey(), letters);
      assertThat(value).as(sample.getKey()).isInstanceOf(BigDecimal.class);
      var number = (BigDecimal) value;
      assertThat(number.scale()).as(sample.getKey()).isGreaterThanOrEqualTo(0);
      assertThat(number.toString()).as(sample.getKey()).isEqualTo(sample.getValue());
    }
    assertThat(((BigDecimal) eval("$SQRT(2.25)")).toString()).isEqualTo("1.5");
    assertThatThrownBy(() -> eval("$POWER(10, 101)"))
        .hasMessage("Number exceeds supported precision or magnitude");
  }
}
