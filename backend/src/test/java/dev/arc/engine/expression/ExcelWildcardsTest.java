package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;

/** POI's wildcard criteria are regular expressions that ARC's deadline cannot interrupt. */
class ExcelWildcardsTest {
  private static final String BACKTRACKING = "\"*a*a*a*a*a*a*b\"";
  private static final Map<String, Object> LONG_TEXT =
      Map.of("text", "a".repeat(2000), "texts", List.of("a".repeat(2000)));

  private static Object eval(String expression, Map<String, Object> scope) {
    return Expressions.evaluate(expression, scope);
  }

  @Test
  void backtrackingCriteriaAreRejectedBeforePoiRunsInEveryWildcardFunction() {
    // Before the bound these calls ran for years on a request thread, past any deadline.
    for (String expression :
        List.of(
            "$COUNTIF(texts, " + BACKTRACKING + ")",
            "$COUNTIF(texts, \"<>*a*a*a*a*a*a*b\")",
            "$SUMIF(texts, " + BACKTRACKING + ", [1])",
            "$MATCH(" + BACKTRACKING + ", texts, 0)",
            "$VLOOKUP(" + BACKTRACKING + ", [[text, 1]], 2, false)",
            "$HLOOKUP(" + BACKTRACKING + ", [[text], [1]], 2, false)",
            "$LOOKUP(" + BACKTRACKING + ", texts)",
            "$DCOUNTA([[\"name\"], [text]], \"name\", [[\"name\"], [" + BACKTRACKING + "]])")) {
      String function = expression.substring(1, expression.indexOf('('));
      assertTimeoutPreemptively(
          Duration.ofSeconds(10),
          () ->
              assertThatThrownBy(() -> eval(expression, LONG_TEXT))
                  .as(expression)
                  .isInstanceOfSatisfying(
                      ArcException.class,
                      error -> {
                        assertThat(error.getMessage())
                            .isEqualTo(
                                function
                                    + ": wildcard criteria need more than 10,000,000 character"
                                    + " comparisons; use fewer * or shorter text");
                        assertThat(error.status()).isEqualTo(422);
                        assertThat(error.recoverable()).isTrue();
                      }));
    }
  }

  @Test
  void orderingComparisonsCompareTextWithoutAWildcardSearch() {
    // POI compares "aaa..." with the text "*a*a*a*a*a*a*b" here, so there is nothing to bound.
    assertThat(eval("$COUNTIF(texts, \">*a*a*a*a*a*a*b\")", LONG_TEXT))
        .isEqualTo(new BigDecimal("1"));
  }

  @Test
  void ordinaryWildcardCriteriaKeepPoiResults() {
    var scope = Map.<String, Object>of("fruit", List.of("apple", "banana", "apricot", "cherry"));
    assertThat(eval("$COUNTIF(fruit, \"ap*\")", scope)).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$COUNTIF(fruit, \"<>ap*\")", scope)).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$COUNTIF(fruit, \"?????\")", scope)).isEqualTo(new BigDecimal("1"));
    assertThat(eval("$SUMIF(fruit, \"*an*\", [1, 2, 3, 4])", scope)).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$MATCH(\"b*\", fruit, 0)", scope)).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$VLOOKUP(\"ch*\", [[\"apple\", 1], [\"cherry\", 4]], 2, false)", scope))
        .isEqualTo(new BigDecimal("4"));
    assertThat(eval("$HLOOKUP(\"ch*\", [[\"apple\", \"cherry\"], [1, 4]], 2, false)", scope))
        .isEqualTo(new BigDecimal("4"));
    assertThat(
            eval(
                "$DCOUNTA([[\"name\"], [\"alice\"], [\"bob\"], [\"alfred\"]], \"name\","
                    + " [[\"name\"], [\"al*\"]])",
                scope))
        .isEqualTo(new BigDecimal("2"));
  }

  @Test
  void largeLinearWildcardSearchesStayWithinTheBound() {
    var descriptions = new ArrayList<Object>();
    for (int i = 0; i < 1000; i++)
      descriptions.add("lorem ipsum ".repeat(16) + (i % 10 == 0 ? "needle" : "hay"));
    assertThat(eval("$COUNTIF(descriptions, \"*needle*\")", Map.of("descriptions", descriptions)))
        .isEqualTo(new BigDecimal("100"));
  }

  @Test
  void theDeadlineIsCheckedAsSoonAsAPoiCalculationReturns() {
    var calls = new ArrayList<List<Object>>();
    Expressions.FormulaCaller recorder =
        (formula, arguments) -> {
          calls.add(arguments);
          return arguments.getFirst();
        };
    var expression = Expressions.compile("@probe:1($SQRT(slow))");
    var deadline = ExecutionDeadline.start(ExecutionDeadline.MIN_TIMEOUT_MS);
    assertThatThrownBy(
            () -> expression.evaluate(Map.of("slow", new SlowNumber()), deadline, recorder))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
    // The expired request must not start the next piece of work, such as a nested rule.
    assertThat(calls).isEmpty();
  }

  /** A number whose conversion for POI takes longer than the shortest execution deadline. */
  private static final class SlowNumber extends Number {
    @Override
    public double doubleValue() {
      try {
        Thread.sleep(ExecutionDeadline.MIN_TIMEOUT_MS + 50);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
      return 4;
    }

    @Override
    public int intValue() {
      return 4;
    }

    @Override
    public long longValue() {
      return 4;
    }

    @Override
    public float floatValue() {
      return 4;
    }
  }
}
