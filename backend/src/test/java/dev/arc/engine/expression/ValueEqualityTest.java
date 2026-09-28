package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** Arrays and objects compare their numbers by value, as top-level numbers always did. */
class ValueEqualityTest {
  // JSON input arrives with Integer elements and 2.50 keeps its scale, while literals are decimals.
  private static final Map<String, Object> SCOPE =
      Map.of(
          "items", List.of(1, 2),
          "pairs", List.of(List.of(1, 2), List.of(3, 4)),
          "customer", Map.of("a", 1, "tags", List.of(new BigDecimal("2.50"))),
          "amount", new BigDecimal("2.50"));

  private static Object eval(String expression) {
    return Expressions.evaluate(expression, SCOPE);
  }

  @Test
  void nestedNumbersCompareByDecimalValue() {
    for (String expression :
        List.of(
            "[1] == [1.0]",
            "items == [1, 2]",
            "items == [1.00, 2]",
            "[amount] == [2.5]",
            "customer == $OBJECT(\"a\", 1.0, \"tags\", [2.5])",
            "[[1], [2.0]] == [[1.0], [2]]",
            "$MAP(items, x, x * 1.0) == [1, 2]",
            "[null, \"a\", true] == [null, \"a\", true]")) {
      assertThat(eval(expression)).as(expression).isEqualTo(true);
      assertThat(eval(expression.replace("==", "!="))).as(expression).isEqualTo(false);
    }
  }

  @Test
  void differentValuesShapesAndTypesStayUnequal() {
    for (String expression :
        List.of(
            "[1, 2] == [2, 1]",
            "[1] == [1, 1]",
            "[1] == [\"1\"]",
            "[1] == 1",
            "[] == $OBJECT()",
            "$OBJECT(\"a\", 1) == $OBJECT(\"b\", 1)",
            "$OBJECT(\"a\", 1) == $OBJECT(\"a\", 1, \"b\", 2)",
            "$OBJECT(\"a\", null) == $OBJECT()",
            "[true] == [1]")) {
      assertThat(eval(expression)).as(expression).isEqualTo(false);
    }
  }

  @Test
  void switchAndContainsUseTheSameEquality() {
    assertThat(eval("$SWITCH(items, [1, 2], \"match\", \"no match\")")).isEqualTo("match");
    assertThat(eval("$CONTAINS(pairs, [1.0, 2])")).isEqualTo(true);
    assertThat(eval("$CONTAINS(pairs, [2, 1])")).isEqualTo(false);
    assertThat(eval("$CONTAINS([customer], $OBJECT(\"tags\", [2.5], \"a\", 1))")).isEqualTo(true);
  }
}
