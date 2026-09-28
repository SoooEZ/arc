package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

/** Language contracts a parser/runtime or third-party engine replacement must retain. */
class ExpressionCompatibilityTest {
  @Test
  void dependencyNamesRemainCaseSensitiveAndCollectionBindingsRemainLexical() {
    var expression = Expressions.compile("amount + Amount + $SUM($MAP(items, item, item.price))");
    assertThat(expression.variables()).containsExactlyInAnyOrder("amount", "Amount", "items");
    assertThat(
            expression.evaluate(
                Map.of("amount", 2, "Amount", 5, "items", List.of(Map.of("price", 3)))))
        .isEqualTo(new BigDecimal("10"));
    assertThat(
            Expressions.compile(
                    "$SUM($MAP(items, item, $SUM($MAP(item.parts, item, item.price)) + item.price))")
                .variables())
        .containsExactly("items");
    assertThat(Expressions.compile("$MAP(items, item, item.price) + item").variables())
        .containsExactlyInAnyOrder("items", "item");
  }

  @Test
  void lazyFunctionsPreserveFalsyValuesAndArrays() {
    assertThat(eval("$COALESCE(null, false, 1 / 0)")).isEqualTo(false);
    assertThat(eval("$COALESCE(null, 0, 1 / 0)")).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$COALESCE(null, '', 1 / 0)")).isEqualTo("");
    assertThat(eval("$COALESCE([null, 2], 1 / 0)"))
        .isEqualTo(Arrays.asList(null, new BigDecimal("2")));
    assertThat(eval("$AND(false, 1 / 0)")).isEqualTo(false);
    assertThat(eval("$OR(true, 1 / 0)")).isEqualTo(true);
    assertThat(eval("$IF(false, 1 / 0, 3)")).isEqualTo(new BigDecimal("3"));
    assertThat(eval("$SWITCH(2, 1, 1 / 0, 2, 7, 1 / 0)")).isEqualTo(new BigDecimal("7"));
  }

  @Test
  void collectionLocalsShadowTheScopeWithoutCopyingIt() {
    var scope = new HashMap<String, Object>();
    scope.put("items", Arrays.asList(1, null, 3));
    scope.put("x", "outer");
    scope.put("acc", "outer");
    // A null item is still bound; it must not fall back to the outer x or be unknown.
    assertThat(Expressions.evaluate("$MAP(items, x, x == null)", scope))
        .isEqualTo(List.of(false, true, false));
    assertThat(Expressions.evaluate("$MAP([1], y, x)", scope)).isEqualTo(List.of("outer"));
    assertThat(Expressions.evaluate("$MAP([[1, 2]], x, $MAP(x, x, x * 10))", scope))
        .isEqualTo(List.of(List.of(new BigDecimal("10"), new BigDecimal("20"))));
    assertThat(
            Expressions.evaluate(
                "$REDUCE([1, 2], x, acc, null, $COALESCE(acc, 0) + x) + $LEN(acc)", scope))
        .isEqualTo(new BigDecimal("8"));
    assertThatThrownBy(() -> Expressions.evaluate("$MAP([1], y, missing)", scope))
        .hasMessage("Unknown variable: missing");
    assertThat(Expressions.evaluate("$FILTER(items, item, item != null)", scope))
        .isEqualTo(List.of(1, 3));
  }

  @Test
  void chooseEvaluatesOnlyTheSelectedValue() {
    // Excel evaluates only the chosen value; every argument used to be evaluated first.
    assertThat(eval("$CHOOSE(1, 5, 1 / 0)")).isEqualTo(new BigDecimal("5"));
    assertThat(eval("$CHOOSE(2, 1 / 0, \"b\")")).isEqualTo("b");
    assertThat(eval("$CHOOSE(1.9, \"a\", \"b\")")).isEqualTo("a");
    assertThat(eval("$CHOOSE(\"2\", \"a\", \"b\")")).isEqualTo("b");
    assertThat(eval("$CHOOSE(1, [5, 6])"))
        .isEqualTo(List.of(new BigDecimal("5"), new BigDecimal("6")));
    assertThat(eval("$CHOOSE(1, null, 1 / 0)")).isNull();
    for (String outOfRange : List.of("$CHOOSE(0, 1, 2)", "$CHOOSE(3, 1, 2)", "$CHOOSE(\"x\", 1)"))
      assertThatThrownBy(() -> eval(outOfRange)).as(outOfRange).hasMessage("CHOOSE: #VALUE!");
    assertThatThrownBy(() -> eval("$CHOOSE([1], 1)"))
        .hasMessage("CHOOSE: argument 1 must be a single value, not an array");
    var calls = new ArrayList<Expressions.FormulaCall>();
    Expressions.FormulaCaller caller =
        (formula, arguments) -> {
          calls.add(formula);
          return BigDecimal.ONE;
        };
    assertThat(
            Expressions.compile("$CHOOSE(2, @first:1(), @second:1())")
                .evaluate(Map.of(), ExecutionDeadline.start(30_000), caller))
        .isEqualTo(BigDecimal.ONE);
    assertThat(calls).containsExactly(new Expressions.FormulaCall("second", 1, 0));
  }

  @Test
  void scalarTypesAndDecimalLiteralPrecisionAreNotCoerced() {
    for (String expression : List.of("'1' + 2", "$IF(1, 2, 3)", "true * 2")) {
      assertThatThrownBy(() -> eval(expression)).isInstanceOf(ArcException.class);
    }
    String preciseLiteral = "1234567890123456789012345678901234567890.123456789";
    assertThat(eval(preciseLiteral)).isEqualTo(new BigDecimal(preciseLiteral));
    assertThat(eval("0.1 + 0.2")).isEqualTo(new BigDecimal("0.3"));
    assertThat(eval("-2^2")).isEqualTo(new BigDecimal("-4"));
    assertThat(eval("2^3^2")).isEqualTo(new BigDecimal("512"));
    assertThat(eval("$ROUND(1.235, 2)")).isEqualTo(new BigDecimal("1.24"));
  }

  @Test
  void missingRootAndMissingObjectFieldHaveDistinctSemantics() {
    assertThatThrownBy(() -> eval("missing.field")).hasMessageContaining("Unknown variable");
    assertThat(Expressions.evaluate("customer.missing", Map.of("customer", Map.of()))).isNull();
    var customer = new HashMap<String, Object>();
    customer.put("value", null);
    assertThat(Expressions.evaluate("$GET(customer, 'value', 5)", Map.of("customer", customer)))
        .isNull();
    assertThat(Expressions.evaluate("$GET(customer, 'missing', 5)", Map.of("customer", customer)))
        .isEqualTo(new BigDecimal("5"));
  }

  @Test
  void jacksonStringDecodingRetainsLegacyArcLiterals() {
    assertThat(eval("'it\\'s \\q \\/ \\u0041'")).isEqualTo("it's q / A");
    assertThat(eval("\"raw\n\t\r" + (char) 0 + "\"")).isEqualTo("raw\n\t\r" + (char) 0);
    assertThat(eval("\"\\\\u0041\"")).isEqualTo("\\u0041");
    assertThat(eval("\"\\uD800\"")).isEqualTo(String.valueOf((char) 0xD800));
    assertThat(eval("\"" + (char) 0xD800 + "\"")).isEqualTo(String.valueOf((char) 0xD800));
    assertThat(eval("'\\b\\f\\n\\r\\t'")).isEqualTo("\b\f\n\r\t");
  }

  @Test
  void compiledExpressionsCanBeReusedAcrossConcurrentEvaluations() throws Exception {
    var expression = Expressions.compile("$SUM($MAP(items, item, item * factor))");
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      List<Callable<Object>> evaluations = new ArrayList<>();
      for (int factor = 1; factor <= 20; factor++) {
        var scope = Map.<String, Object>of("items", List.of(1, 2, 3), "factor", factor);
        evaluations.add(() -> expression.evaluate(scope));
      }
      var results = executor.invokeAll(evaluations);
      for (int index = 0; index < results.size(); index++)
        assertThat(results.get(index).get()).isEqualTo(BigDecimal.valueOf((index + 1L) * 6));
    }
  }

  @Test
  void aFailedEvaluationDoesNotConsumeTheNextEvaluationsBudget() {
    var expression = Expressions.compile("$SUM($MAP(items, x, $SUM($MAP(items, y, y))))");
    assertThatThrownBy(() -> expression.evaluate(Map.of("items", Collections.nCopies(101, 1))))
        .hasMessageContaining("10,000 operations");
    assertThat(expression.evaluate(Map.of("items", List.of(1, 2)))).isEqualTo(new BigDecimal("6"));
  }

  @Test
  void reentrantEvaluationCannotResetItsCallersBudget() {
    Map<String, Object> item =
        new HashMap<>(Map.of("price", 1)) {
          @Override
          public Object get(Object key) {
            // An embedded caller may supply a Map that obtains a value through another formula.
            Expressions.evaluate("$ABS(1)", Map.of());
            return super.get(key);
          }
        };
    var expression = Expressions.compile("$SUM($MAP(items, x, $SUM($MAP(items, y, y.price))))");
    assertThatThrownBy(() -> expression.evaluate(Map.of("items", Collections.nCopies(101, item))))
        .hasMessageContaining("10,000 operations");
  }

  private Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }
}
