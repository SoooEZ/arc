package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.InputTypes;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ExpressionsTest {
  private Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  @Test
  void arithmeticIsDecimalAndRespectsPrecedence() {
    assertThat(eval("0.1 + 0.2")).isEqualTo(new BigDecimal("0.3"));
    assertThat(eval("2 + 3 * 4")).isEqualTo(new BigDecimal("14"));
    assertThat(eval("(2 + 3) * -4")).isEqualTo(new BigDecimal("-20"));
    assertThat(eval("10 % 3")).isEqualTo(new BigDecimal("1"));
  }

  @Test
  void roundingAndFunctionsAreDeterministic() {
    assertThat(eval("$round(19.995, 2)")).isEqualTo(new BigDecimal("20.00"));
    assertThat(eval("$max(2, $min(10, 5)) + $abs(-3)")).isEqualTo(new BigDecimal("8"));
    assertThat(eval("$ceil(2.1) + $floor(2.9)")).isEqualTo(new BigDecimal("5"));
  }

  @Test
  void logicalOperatorsShortCircuit() {
    assertThat(eval("false && 1 / 0 > 0")).isEqualTo(false);
    assertThat(eval("true || 1 / 0 > 0")).isEqualTo(true);
    assertThat(eval("$if(true, 42, 1 / 0)")).isEqualTo(new BigDecimal("42"));
    assertThat(eval("!false && (1 == 1.0) && (2 <= 3)")).isEqualTo(true);
  }

  @Test
  void stringsAndInputs() {
    assertThat(
            Expressions.evaluate("customerTier == \"premium\"", Map.of("customerTier", "premium")))
        .isEqualTo(true);
    assertThat(eval("'hello' != 'world'")).isEqualTo(true);
    assertThat(eval("\"hello\\nworld\"")).isEqualTo("hello\nworld");
    assertThat(Expressions.compile("amount * (1 - rate)").variables())
        .containsExactlyInAnyOrder("amount", "rate");
  }

  @Test
  void invalidExpressionsFailClearly() {
    assertThatThrownBy(() -> eval("1 / 0")).hasMessageContaining("Division by zero");
    assertThatThrownBy(() -> eval("missing + 1")).hasMessageContaining("Unknown variable");
    assertThatThrownBy(() -> eval("1 +")).hasMessageContaining("Incomplete expression");
    assertThatThrownBy(() -> eval("$round(1, 99)")).hasMessageContaining("-12 to 12");
    assertThatThrownBy(() -> eval("$round(1, 0.5)")).hasMessageContaining("integer");
    assertThatThrownBy(() -> eval("$max()")).hasMessageContaining("argument count");
    assertThatThrownBy(() -> eval("true + 1")).hasMessageContaining("Expected a number");
  }

  @Test
  void arbitraryCodeAndExcessiveWorkAreRejected() {
    for (String expression :
        new String[] {
          "Runtime.getRuntime()",
          "new ProcessBuilder()",
          "T(java.lang.Runtime)",
          "$T(java.lang.Runtime)",
          "system('whoami')",
          "1e9999",
          "1 + ".repeat(200) + "1",
          "(".repeat(60) + "1" + ")".repeat(60)
        }) {
      assertThatThrownBy(() -> eval(expression)).as(expression).isInstanceOf(ArcException.class);
    }
  }

  @Test
  void decimalFailuresRemainCatchableExpressionErrors() {
    assertThatThrownBy(() -> eval("1e40 % 3"))
        .isInstanceOf(ArcException.class)
        .hasMessageContaining("Decimal operation");
    assertThat(eval("$IFERROR(1e40 % 3, 7)")).isEqualTo(new BigDecimal("7"));
  }

  @Test
  void isnaRecognizesExcelNotAvailableByKindRatherThanMessageText() {
    assertThatThrownBy(() -> eval("$MATCH(\"zz\", [\"a\"], 0)"))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo("MATCH: #N/A");
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.NOT_AVAILABLE);
            });
    assertThat(eval("$ISNA($MATCH(\"zz\", [\"a\"], 0))")).isEqualTo(true);
    assertThat(eval("$ISERR($MATCH(\"zz\", [\"a\"], 0))")).isEqualTo(false);
    assertThat(eval("$ISERROR($MATCH(\"zz\", [\"a\"], 0))")).isEqualTo(true);
    // A duplicate-key error whose message merely contains the text "#N/A" is an ordinary error.
    String duplicateKey = "$OBJECT(\"#N/A\", 1, \"#N/A\", 2)";
    assertThatThrownBy(() -> eval(duplicateKey)).hasMessage("Duplicate OBJECT key: #N/A");
    assertThat(eval("$ISNA(" + duplicateKey + ")")).isEqualTo(false);
    assertThat(eval("$ISERR(" + duplicateKey + ")")).isEqualTo(true);
    assertThat(eval("$ISERROR(" + duplicateKey + ")")).isEqualTo(true);
  }

  @Test
  void errorFunctionsCannotHideTheOperationBudget() {
    String heavy = "$SUM($MAP(items, x, $SUM($MAP(items, y, y))))";
    var items = Map.<String, Object>of("items", Collections.nCopies(101, 1));
    for (String expression :
        new String[] {
          "$IFERROR(" + heavy + ", 0)",
          "$ISERROR(" + heavy + ")",
          "$ISERR(" + heavy + ")",
          "$ISNA(" + heavy + ")"
        }) {
      assertThatThrownBy(() -> Expressions.evaluate(expression, items))
          .as(expression)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo("Expression exceeds 10,000 operations");
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
              });
    }
  }

  @Test
  void decimalBoundsNeverConvertTheDecimalToADouble() {
    // Every operand and result is bounded; the double conversion of a 34-digit quotient is slow
    // and cannot fail for a decimal within the precision and scale limits.
    var third = new BigDecimal("0.3333333333333333333333333333333333");
    var noDouble =
        new BigDecimal(third.unscaledValue(), third.scale()) {
          @Override
          public double doubleValue() {
            throw new AssertionError("bounded() converted a decimal to double");
          }
        };
    assertThat(Expressions.bounded(noDouble)).isSameAs(noDouble);
    assertThat(Expressions.bounded(List.of(noDouble, Map.of("x", noDouble)))).isNotNull();
    for (Object nonFinite :
        List.of(Double.NaN, Double.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) {
      assertThatThrownBy(() -> Expressions.bounded(nonFinite))
          .isInstanceOf(ArcException.class)
          .hasMessage("Number must be finite");
    }
    // A 401-digit integer is out of range like a 401-digit decimal, not "not finite".
    assertThatThrownBy(() -> Expressions.bounded(BigInteger.TEN.pow(400)))
        .hasMessage("Number exceeds supported precision or magnitude");
  }

  @Test
  void zerosAreBoundedByTheirScaleAsWritten() {
    // A zero has no digits to strip, so 0E-2000000000 passed every bound and printed as two
    // billion characters.
    for (String zero : List.of("0", "-0.0", "0.000", "0E-100", "0E+100"))
      assertThat(Expressions.bounded(new BigDecimal(zero))).as(zero).isNotNull();
    for (String zero : List.of("0E-101", "0E+101", "0E-2147483647"))
      assertThatThrownBy(() -> Expressions.bounded(new BigDecimal(zero)))
          .as(zero)
          .hasMessage("Number exceeds supported precision or magnitude");
    assertThatThrownBy(() -> InputTypes.check("x", "NUMBER", new BigDecimal("0E-10000")))
        .hasMessage("Number exceeds supported precision or magnitude");
    assertThatThrownBy(() -> Expressions.compile("0e-2147483647"))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(422));
    for (String expression :
        List.of(
            "$TO_STRING(((((0.0 ^ 100) ^ 100) ^ 100) ^ 100) ^ 10)",
            "$CONCAT(\"\", 0e-2000000000)",
            "$CONTAINS(\"x\", $TO_NUMBER(\"0e-2000000000\"))"))
      assertTimeoutPreemptively(
          Duration.ofSeconds(1),
          () ->
              assertThatThrownBy(() -> eval(expression))
                  .as(expression)
                  .isInstanceOfSatisfying(
                      ArcException.class,
                      error -> {
                        assertThat(error.status()).isEqualTo(422);
                        assertThat(error.getMessage())
                            .contains("Number exceeds supported precision or magnitude");
                      }));
  }

  @Test
  void integersFollowTheDecimalBoundWhereverValuesAreBounded() {
    // Jackson reads a JSON integer beyond a long as BigInteger; only decimals were bounded.
    var beyondPrecision = new BigInteger("9".repeat(150));
    assertThat(Expressions.bounded(BigInteger.TEN.pow(100))).isNotNull();
    assertThat(Expressions.bounded(Map.of("a", BigInteger.TEN.pow(100)))).isNotNull();
    assertThatThrownBy(() -> Expressions.bounded(Map.of("a", beyondPrecision)))
        .hasMessage("Number exceeds supported precision or magnitude");
    assertThatThrownBy(() -> InputTypes.check("v", "ARRAY", List.of(beyondPrecision)))
        .hasMessage("Number exceeds supported precision or magnitude");
    assertThat(Expressions.number(beyondPrecision.pow(0))).isEqualByComparingTo(BigDecimal.ONE);
  }

  @Test
  void decimalBoundsDependOnTheNumberNotOnHowItIsWritten() {
    // PostgreSQL JSONB stores a default of 1E+100 as its 101-digit integer.
    var written = new BigDecimal(new BigInteger("1" + "0".repeat(100)));
    assertThat(written.precision()).isEqualTo(101);
    assertThat(Expressions.bounded(written)).isSameAs(written);
    assertThat(Expressions.bounded(new BigDecimal("1E+100"))).isNotNull();
    assertThat(Expressions.bounded(new BigDecimal("1." + "0".repeat(150)))).isNotNull();
    for (BigDecimal tooLarge :
        List.of(
            new BigDecimal("1E+101"),
            new BigDecimal(new BigInteger("1" + "0".repeat(101))),
            new BigDecimal(new BigInteger("1".repeat(102))),
            new BigDecimal("1E-101"))) {
      assertThatThrownBy(() -> Expressions.bounded(tooLarge))
          .as(tooLarge.toString())
          .hasMessage("Number exceeds supported precision or magnitude");
    }
    assertThat((BigDecimal) Expressions.evaluate("amount / 10", Map.of("amount", written)))
        .isEqualByComparingTo(new BigDecimal("1E+99"));
  }

  @Test
  void roundingRejectsIntegerMinimumPrecisionWithoutOverflow() {
    for (String function : new String[] {"ROUND", "ROUNDDOWN", "ROUNDUP"}) {
      assertThatThrownBy(() -> eval("$" + function + "(1, -2147483648)"))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("-12 to 12");
    }
  }

  @Test
  void jsonEncodedStringConstantsPreserveTheirCharacters() throws Exception {
    String original = "control:\b\f" + (char) 0 + "\n\t\r quote:\" slash:\\ 中文";
    String literal = new ObjectMapper().writeValueAsString(original);
    assertThat(eval(literal)).isEqualTo(original);
    assertThat(eval("\"\\u4e2d\\u6587\\uD83D\\uDE00\"")).isEqualTo("中文😀");
    assertThat(eval("'it\\'s \\u0041\\b\\f'")).isEqualTo("it's A\b\f");
  }

  @Test
  void malformedUnicodeEscapesAreExpressionErrors() {
    for (String literal : new String[] {"\"\\u12\"", "\"\\uZZZZ\"", "'\\u-123'"}) {
      assertThatThrownBy(() -> eval(literal))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("Unicode escape");
    }
  }

  @Test
  void typeErrorsNameArcTypesWhateverTheValuesOrigin() {
    // The message named JDK classes before: UnmodifiableMap, LinkedHashMap, ListN, BigDecimal.
    for (Object value :
        List.of(
            new LinkedHashMap<String, Object>(),
            Collections.unmodifiableMap(Map.of("a", 1)),
            Map.of()))
      assertThatThrownBy(() -> Expressions.bool(value))
          .hasMessage("Expected a boolean, got object");
    for (Object value :
        List.of(List.of(1, 2), new ArrayList<>(), Collections.unmodifiableList(List.of(1))))
      assertThatThrownBy(() -> Expressions.bool(value)).hasMessage("Expected a boolean, got array");
    for (Object value : List.of(BigDecimal.ONE, 1, 1.5))
      assertThatThrownBy(() -> Expressions.bool(value))
          .hasMessage("Expected a boolean, got number");
    assertThatThrownBy(() -> Expressions.bool("x")).hasMessage("Expected a boolean, got string");
    assertThatThrownBy(() -> Expressions.bool(null)).hasMessage("Expected a boolean, got null");
    assertThatThrownBy(() -> Expressions.number(Map.of()))
        .hasMessage("Expected a number, got object");
    assertThatThrownBy(() -> Expressions.number(true)).hasMessage("Expected a number, got boolean");
  }

  @Test
  void operatorsKeepTheirMeaningWhenClassifiedAtParseTime() {
    // Every operator was re-classified by matching its token against sets on each evaluation.
    assertThat(eval("1 = 1 && 2 <> 3")).isEqualTo(true);
    assertThat(eval("1 == 2 || 2 != 2")).isEqualTo(false);
    assertThat(eval("true AND false OR true")).isEqualTo(true);
    assertThat(eval("false OR false AND true")).isEqualTo(false);
    assertThat(eval("\"b\" > \"a\" && \"a\" <= \"a\" && 2 >= 3 == false")).isEqualTo(true);
    assertThat(eval("2 ^ 3 ^ 2")).isEqualTo(new BigDecimal("512"));
    assertThat(eval("-2 ^ 2")).isEqualTo(new BigDecimal("-4"));
    assertThat(eval("2 * 3 ^ 2 - 10 % 4 / 2")).isEqualTo(new BigDecimal("17"));
    assertThat(eval("7 % 3 + 1")).isEqualTo(new BigDecimal("2"));
    assertThatThrownBy(() -> eval("1 / 0")).hasMessage("Division by zero");
    assertThatThrownBy(() -> eval("1 % 0")).hasMessage("Division by zero");
    assertThatThrownBy(() -> eval("2 ^ 0.5")).hasMessage("Exponent must be an integer");
    assertThatThrownBy(() -> eval("2 ^ 101")).hasMessage("Exponent must be -100 to 100");
  }

  @Test
  void indexSegmentsAreReadAsAsciiDigitsWithoutARegex() {
    var row = new LinkedHashMap<String, Object>();
    row.put("tags", List.of("a", "b"));
    var scope = Map.<String, Object>of("r", row, "rows", List.of(row));
    assertThat(Expressions.evaluate("r.tags.0", scope)).isEqualTo("a");
    assertThat(Expressions.evaluate("r.tags.01", scope)).isEqualTo("b");
    assertThat(Expressions.evaluate("$PLUCK(rows, \"tags.1\")", scope)).isEqualTo(List.of("b"));
    assertThat(Expressions.evaluate("$GET(r, \"tags.0\", \"none\")", scope)).isEqualTo("a");
    // Seven digits, a non-ASCII digit and an index past the end all fall back.
    for (String path : List.of("tags.0000000", "tags.\uff11", "tags.2", "tags.-1"))
      assertThat(Expressions.evaluate("$GET(r, \"" + path + "\", \"none\")", scope))
          .as(path)
          .isEqualTo("none");
    assertThat(Functions.arrayIndex("000001")).isEqualTo(1);
    assertThat(Functions.arrayIndex("1234567")).isEqualTo(-1);
    assertThat(Functions.arrayIndex("")).isEqualTo(-1);
  }

  /**
   * One row per constant: each aggregate and collection function owns its behavior, and the
   * switches over them are exhaustive, so this table fails to compile for a constant it misses.
   */
  @Test
  void everyDecimalAggregateAndCollectionFunctionHasItsOwnBehavior() {
    for (DecimalAggregate aggregate : DecimalAggregate.values()) {
      BigDecimal expected =
          switch (aggregate) {
            case SUM -> new BigDecimal("13");
            case MIN -> new BigDecimal("1");
            case MAX -> new BigDecimal("10");
            case AVG, AVERAGE -> new BigDecimal("13").divide(new BigDecimal("3"), Expressions.MATH);
            case COUNT -> new BigDecimal("3");
            case MUL -> new BigDecimal("20");
          };
      assertThat(eval("$" + aggregate.name() + "(1, 2, 10)"))
          .as(aggregate.name())
          .isEqualTo(expected);
      assertThat(eval("$" + aggregate.name() + "([1, [2, 10]])"))
          .as(aggregate.name())
          .isEqualTo(expected);
      String empty = "$" + aggregate.name() + "([])";
      switch (aggregate) {
        case SUM, COUNT -> assertThat(eval(empty)).as(empty).isEqualTo(BigDecimal.ZERO);
        case MUL -> assertThat(eval(empty)).as(empty).isEqualTo(BigDecimal.ONE);
        case MIN, MAX, AVG, AVERAGE ->
            assertThatThrownBy(() -> eval(empty))
                .as(empty)
                .hasMessage(aggregate.name() + " requires values");
      }
    }
    for (CollectionFunction function : CollectionFunction.values()) {
      String call =
          switch (function) {
            case MAP -> "$MAP([1, 2, 3], item, item * 2)";
            case FILTER -> "$FILTER([1, 2, 3], item, item > 1)";
            case ALL -> "$ALL([1, 2, 3], item, item > 1)";
            case ANY -> "$ANY([1, 2, 3], item, item > 1)";
            case REDUCE -> "$REDUCE([1, 2, 3], item, acc, 0, acc + item)";
          };
      Object expected =
          switch (function) {
            case MAP -> List.of(new BigDecimal("2"), new BigDecimal("4"), new BigDecimal("6"));
            case FILTER -> List.of(new BigDecimal("2"), new BigDecimal("3"));
            case ALL -> false;
            case ANY -> true;
            case REDUCE -> new BigDecimal("6");
          };
      assertThat(eval(call)).as(function.name()).isEqualTo(expected);
    }
    assertThat(eval("$ALL([], item, item > 1)")).isEqualTo(true);
    assertThat(eval("$ANY([], item, item > 1)")).isEqualTo(false);
    assertThatThrownBy(() -> eval("$REDUCE([1], item, item, 0, item)"))
        .hasMessage("REDUCE needs distinct item and accumulator identifiers");
  }

  @Test
  void aRangeIsConvertedOncePerEvaluationAndNeverAcrossEvaluations() {
    var compiled = Expressions.compile("$SUM($MAP(keys, k, $VLOOKUP(k, table, 2, FALSE)))");
    List<Object> table = List.of(List.of("a", 1), List.of("b", 2), List.of("c", 3));
    var scope = Map.<String, Object>of("keys", List.of("a", "b", "c", "a"), "table", table);
    assertThat(compiled.evaluate(scope)).isEqualTo(new BigDecimal("7"));
    List<Object> other = List.of(List.of("a", 10), List.of("b", 20), List.of("c", 30));
    assertThat(compiled.evaluate(Map.of("keys", List.of("a", "c"), "table", other)))
        .isEqualTo(new BigDecimal("40"));
    // Separate calls give the same values as the calls inside one $MAP.
    assertThat(Expressions.evaluate("$VLOOKUP(\"b\", table, 2, FALSE)", scope))
        .isEqualTo(new BigDecimal("2"));
  }
}
