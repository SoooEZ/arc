package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.formula.eval.OperandResolver;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;
import org.apache.poi.ss.formula.ptg.Ptg;
import org.junit.jupiter.api.Test;

/**
 * POI's wildcard and number patterns are regular expressions that ARC's deadline cannot interrupt.
 */
class ExcelMatchingWorkTest {
  private static final String BACKTRACKING = "\"*a*a*a*a*a*a*b\"";
  private static final Map<String, Object> LONG_TEXT =
      Map.of("text", "a".repeat(2000), "texts", List.of("a".repeat(2000)));

  /** Digits followed by a letter make POI's number pattern backtrack over every split. */
  private static final String DIGITS_THEN_LETTER = "1".repeat(1999) + "x";

  private static final Map<String, Object> DIGIT_TEXT = digitTextScope(20, DIGITS_THEN_LETTER);

  private static Map<String, Object> digitTextScope(int count, String text) {
    var cells = new ArrayList<Object>();
    var numbers = new ArrayList<Object>();
    for (int index = 0; index < count; index++) {
      cells.add(text);
      numbers.add(BigDecimal.valueOf(index + 1));
    }
    return Map.of("cells", cells, "nums", numbers);
  }

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
  void numericCriteriaAndTwoRangeStatisticsAreRejectedBeforePoiParsesLongDigitText() {
    // Before the bound, 1,000 such cells held a request thread for about 75 s in one call.
    for (String expression :
        List.of(
            "$COUNTIF(cells, 5)",
            "$COUNTIF(cells, \"5\")",
            "$COUNTIF(cells, \"=5\")",
            "$SUMIF(cells, 5, nums)",
            "$SUMIF(cells, \"=5\", nums)",
            "$CORREL(cells, nums)",
            "$COVAR(nums, cells)",
            "$PEARSON(cells, nums)",
            "$FORECAST(1, cells, nums)")) {
      String function = expression.substring(1, expression.indexOf('('));
      assertTimeoutPreemptively(
          Duration.ofSeconds(1),
          () ->
              assertThatThrownBy(() -> eval(expression, DIGIT_TEXT))
                  .as(expression)
                  .isInstanceOfSatisfying(
                      ArcException.class,
                      error -> {
                        assertThat(error.getMessage())
                            .isEqualTo(
                                function
                                    + ": numeric text needs more than 10,000,000 character"
                                    + " comparisons; use shorter text");
                        assertThat(error.status()).isEqualTo(422);
                        assertThat(error.recoverable()).isTrue();
                      }));
    }
  }

  @Test
  void criteriaThatDoNotParseTextAreNotChargedForIt() {
    // <>5 matches every text cell and >5 none, both without POI parsing the text.
    assertThat(eval("$COUNTIF(cells, \"<>5\")", DIGIT_TEXT)).isEqualTo(new BigDecimal("20"));
    assertThat(eval("$COUNTIF(cells, \">5\")", DIGIT_TEXT)).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$SUMIF(cells, \"<=5\", nums)", DIGIT_TEXT)).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$SUMIF(cells, true, nums)", DIGIT_TEXT)).isEqualTo(BigDecimal.ZERO);
    // The sum range is never parsed, and a lookup compares the text without parsing it.
    assertThat(eval("$SUMIF(nums, 2, cells)", DIGIT_TEXT)).isEqualTo(BigDecimal.ZERO);
    assertThatThrownBy(() -> eval("$MATCH(5, cells, 0)", DIGIT_TEXT)).hasMessage("MATCH: #N/A");
  }

  @Test
  void numericTextThatPoiParsesCheaplyKeepsItsResults() {
    var scope =
        Map.<String, Object>of(
            "cells",
            List.of("12", " 3.5", "abc", "5", "1e1", ""),
            "nums",
            List.of(1, 2, 3, 4, 5, 6));
    assertThat(eval("$COUNTIF(cells, 5)", scope)).isEqualTo(new BigDecimal("1"));
    assertThat(eval("$COUNTIF(cells, \"=10\")", scope)).isEqualTo(new BigDecimal("1"));
    assertThat(eval("$SUMIF(cells, \"3.5\", nums)", scope)).isEqualTo(new BigDecimal("2"));
    // Digits without a trailing letter parse in one pass, so long numeric text stays cheap.
    var longNumbers = digitTextScope(20, "1".repeat(1999));
    assertThat(eval("$COUNTIF(cells, 5)", longNumbers)).isEqualTo(BigDecimal.ZERO);
    assertThat(eval("$SUMIF(cells, \"=5\", nums)", longNumbers)).isEqualTo(BigDecimal.ZERO);
  }

  @Test
  void theNumberPatternIsPoisOwn() throws Exception {
    var field = OperandResolver.class.getDeclaredField("fpPattern");
    field.setAccessible(true);
    assertThat(((Pattern) field.get(null)).pattern())
        .isEqualTo(ExcelMatchingWork.POI_NUMBER_PATTERN);
  }

  /**
   * Every supported POI function is called with long digit text in each range position. A function
   * that parses every cell must be listed in {@link ExcelMatchingWork} and is rejected up front;
   * any other finishes as fast as at most one parse, so a POI upgrade cannot add a slow path
   * unnoticed.
   */
  @Test
  void everySupportedExcelFunctionEitherRejectsOrBarelyParsesLongDigitTextRanges() {
    var scope = digitTextScope(20, "1".repeat(1499) + "x");
    long oneParseNanos = timeToParse((String) ((List<?>) scope.get("cells")).getFirst());
    var slow = new ArrayList<String>();
    for (Functions.Entry entry : Functions.catalog()) {
      if (!entry.supported() || !entry.origin().equals("Excel / Apache POI")) continue;
      String name = entry.name().substring(1);
      var metadata = FunctionMetadataRegistry.getFunctionByName(name);
      byte[] classes = metadata.getParameterClassCodes();
      int least = Math.max(1, metadata.getMinParams());
      int most = Math.min(metadata.getMaxParams(), Math.max(least, 3));
      for (int count = least; count <= most; count++)
        for (int rangeAt = 0; rangeAt < count; rangeAt++) {
          var arguments = new ArrayList<String>();
          boolean hasRange = false;
          for (int index = 0; index < count; index++) {
            byte parameterClass = classes[Math.min(index, classes.length - 1)];
            boolean range = index == rangeAt && parameterClass != Ptg.CLASS_VALUE;
            hasRange |= range;
            arguments.add(range ? "cells" : parameterClass == Ptg.CLASS_VALUE ? "2" : "nums");
          }
          if (!hasRange) continue;
          String expression = "$" + name + "(" + String.join(", ", arguments) + ")";
          long started = System.nanoTime();
          String outcome =
              assertTimeoutPreemptively(Duration.ofSeconds(5), () -> outcome(expression, scope));
          long elapsed = System.nanoTime() - started;
          // Rejected calls stop before POI runs; anything else parses at most one cell.
          if (!outcome.contains("numeric text needs more than") && elapsed > 6 * oneParseNanos)
            slow.add(expression + " took " + elapsed / 1_000_000 + " ms: " + outcome);
        }
    }
    assertThat(slow).isEmpty();
  }

  private static long timeToParse(String text) {
    OperandResolver.parseDouble(text);
    long started = System.nanoTime();
    for (int repeat = 0; repeat < 3; repeat++) OperandResolver.parseDouble(text);
    return Math.max((System.nanoTime() - started) / 3, 20_000_000L);
  }

  private static String outcome(String expression, Map<String, Object> scope) {
    try {
      return String.valueOf(eval(expression, scope));
    } catch (ArcException error) {
      return error.getMessage();
    }
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
