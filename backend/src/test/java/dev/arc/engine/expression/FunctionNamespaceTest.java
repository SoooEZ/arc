package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FunctionNamespaceTest {
  @Test
  void functionsAndCaseSensitiveVariablesCanShareTheirNames() {
    var expression = Expressions.compile("$ROUND(ROUND, 2) + $round(round, 1)");
    assertThat(expression.variables()).containsExactlyInAnyOrder("ROUND", "round");
    assertThat(expression.evaluate(Map.of("ROUND", new BigDecimal("1.235"), "round", 2)))
        .isEqualTo(new BigDecimal("3.24"));
    assertThat(Expressions.evaluate("$ROUND(ROUND, 2) + round", Map.of("ROUND", 2, "round", 3)))
        .isEqualTo(new BigDecimal("5.00"));
  }

  @Test
  void lazyAndExcelCallsKeepTheirExistingSemanticsAndDollarStringsStayLiteral() {
    assertThat(eval("$IF(false, 1 / 0, $COALESCE(null, 0, 1 / 0))")).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$AND(false, 1 / 0) || $OR(true, 1 / 0)")).isEqualTo(true);
    assertThat(eval("$SWITCH(2, 1, 1 / 0, 2, $ABS(-7), 1 / 0)")).isEqualTo(new BigDecimal("7"));
    assertThat(eval("$IFERROR($ERROR.TYPE(1), 7)")).isEqualTo(new BigDecimal("7"));
    assertThat(eval("$UPPER('hello')")).isEqualTo("HELLO");
    assertThat(eval("$CONCAT('$ROUND(1) costs $5', \" and ROUND(2)\")"))
        .isEqualTo("$ROUND(1) costs $5 and ROUND(2)");
    assertThatThrownBy(() -> eval("$NORM.DIST(1)"))
        .isInstanceOf(ArcException.class)
        .hasMessage("Unsupported function: NORM.DIST (see function catalog)");
  }

  @Test
  void collectionFunctionsRetainLexicalLocalScopes() {
    var expression =
        Expressions.compile(
            "$SUM($MAP(items, ROUND, $ROUND(ROUND.price, 0))) + "
                + "$REDUCE($FILTER(items, item, item.price > 1), item, acc, 0, acc + item.price)");
    assertThat(expression.variables()).containsExactly("items");
    assertThat(
            expression.evaluate(Map.of("items", List.of(Map.of("price", 1), Map.of("price", 2)))))
        .isEqualTo(new BigDecimal("5"));
    assertThat(eval("$ALL([1, 2], x, x > 0) && $ANY([1, 2], x, x == 2)")).isEqualTo(true);
    assertThat(
            Expressions.compile(
                    "$MAP(items, item, $SUM($MAP(item.parts, item, item.price))) + item")
                .variables())
        .containsExactlyInAnyOrder("items", "item");
  }

  @Test
  void everyFunctionCallRequiresItsDollarPrefixIncludingNestedAndLazyBranches() {
    for (var sample :
        Map.of(
                "round(1, 2)", "ROUND",
                "SUM([1, 2])", "SUM",
                "MAP([1], item, item)", "MAP",
                "$IF(true, 1, ROUND(2))", "ROUND",
                "$IFERROR(ERROR.TYPE(1), 7)", "ERROR.TYPE")
            .entrySet()) {
      assertThatThrownBy(() -> Expressions.compile(sample.getKey()))
          .as(sample.getKey())
          .isInstanceOf(ArcException.class)
          .hasMessage("Function calls require a $ prefix; use $" + sample.getValue() + "(...)");
    }
    assertThat(Expressions.compile("ROUND + round").variables())
        .containsExactlyInAnyOrder("ROUND", "round");
  }

  @Test
  void dollarIsReservedForFunctionCallsAndNotVariableOrLocalIdentifiers() {
    for (String expression :
        List.of(
            "$ROUND",
            "$input.value",
            "input.$field",
            "$$ROUND(1)",
            "$MAP([1], $item, $item)",
            "$REDUCE([1], item, $acc, 0, item)")) {
      assertThatThrownBy(() -> Expressions.compile(expression))
          .as(expression)
          .isInstanceOf(ArcException.class);
    }
  }

  private static Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }
}
