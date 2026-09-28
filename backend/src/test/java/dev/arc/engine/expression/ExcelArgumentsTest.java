package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.formula.function.FunctionMetadata;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;
import org.apache.poi.ss.formula.functions.Function;
import org.apache.poi.ss.formula.ptg.Ptg;
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
  void referenceParametersThatExcelReadsAsOneValueRejectArrays() {
    // POI marks these parameters as references, so the value-class check did not cover them, and
    // an array there silently used its first element: this VLOOKUP read column 3 and answered 200.
    String database = "[[\"qty\", \"price\"], [1, 10], [2, 20]]";
    String criteria = "[[\"qty\"], [\">0\"]]";
    for (var sample :
        Map.of(
                "$VLOOKUP(2, [[1, 10, 100], [2, 20, 200]], [3, 2], false)",
                "VLOOKUP: argument 3",
                "$HLOOKUP(2, [[1, 2], [10, 20], [100, 200]], [3, 2], false)",
                "HLOOKUP: argument 3",
                "$MATCH(\"b\", [\"a\", \"b\"], [0, 1])",
                "MATCH: argument 3",
                "$DSUM(" + database + ", [\"qty\", \"price\"], " + criteria + ")",
                "DSUM: argument 2",
                "$DGET(" + database + ", [3, 2], " + criteria + ")",
                "DGET: argument 2",
                "$T([\"a\", \"b\"])",
                "T: argument 1")
            .entrySet()) {
      assertThatThrownBy(() -> eval(sample.getKey()))
          .as(sample.getKey())
          .isInstanceOf(ArcException.class)
          .hasMessage(sample.getValue() + " must be a single value, not an array");
    }
    // The scalar forms and the range parameters keep their results.
    assertThat(eval("$VLOOKUP(2, [[1, 10, 100], [2, 20, 200]], 3, false)"))
        .isEqualTo(new BigDecimal("200"));
    assertThat(eval("$HLOOKUP(2, [[1, 2], [10, 20], [100, 200]], 3, false)"))
        .isEqualTo(new BigDecimal("200"));
    assertThat(eval("$MATCH(\"b\", [\"a\", \"b\"], 0)")).isEqualTo(new BigDecimal("2"));
    assertThat(eval("$DSUM(" + database + ", \"price\", " + criteria + ")"))
        .isEqualTo(new BigDecimal("30"));
    assertThat(eval("$DGET(" + database + ", 2, [[\"qty\"], [2]])"))
        .isEqualTo(new BigDecimal("20"));
    assertThat(eval("$T(\"a\")")).isEqualTo("a");
  }

  /**
   * Reference parameters whose probe outcomes never differ between an array and its first cell
   * although Excel reads a range there, because the probe's generic arguments cannot exercise them:
   * the database and criteria of the database functions need headed tables; SUMIF's sum range and
   * LOOKUP's result vector are read in step with a range the probe passes as one cell; CORREL,
   * COVAR and PEARSON need two ranges of one size; and AREAS counts areas, of which any array is
   * one.
   */
  private static final Set<String> RANGES_THE_PROBE_CANNOT_TELL = rangesTheProbeCannotTell();

  private static Set<String> rangesTheProbeCannotTell() {
    var parameters =
        new HashSet<>(
            Set.of(
                "SUMIF:3",
                "LOOKUP:3",
                "CORREL:1",
                "CORREL:2",
                "COVAR:1",
                "COVAR:2",
                "PEARSON:1",
                "PEARSON:2",
                "AREAS:1"));
    for (String function : ExcelMatchingWork.DATABASE_FUNCTIONS) {
      parameters.add(function + ":1");
      parameters.add(function + ":3");
    }
    return Set.copyOf(parameters);
  }

  /** An array in a probed parameter, and the first cell POI would read instead. */
  private record Probe(Object array, Object firstCell) {}

  private static final List<Probe> PROBES =
      List.of(
          new Probe(List.of(1, 2), 1),
          new Probe(List.of(2, 1), 2),
          new Probe(List.of(List.of(1, 2)), 1),
          new Probe(List.of(-1, 2), -1),
          new Probe(List.of("a", "b"), "a"),
          new Probe(Arrays.asList(1, null), 1));

  @Test
  void everyReferenceParameterThatReadsOneValueIsListed() {
    // A parameter the adapter's table misses would silently use an array's first cell again.
    var readAsOneValue = new TreeSet<String>();
    for (String name : poiEvaluatedFunctions()) {
      FunctionMetadata metadata = FunctionMetadataRegistry.getFunctionByName(name);
      byte[] classes = metadata.getParameterClassCodes();
      for (int index = 0; index < classes.length; index++)
        if (classes[index] != Ptg.CLASS_VALUE && firstCellDecides(metadata, index))
          readAsOneValue.add(name + ":" + (index + 1));
    }
    var expected = new TreeSet<>(RANGES_THE_PROBE_CANNOT_TELL);
    for (var parameter : ExcelFunctionAdapter.SINGLE_VALUE_REFERENCES)
      expected.add(parameter.function() + ":" + (parameter.index() + 1));
    assertThat(readAsOneValue).isEqualTo(expected);
  }

  /** The Excel functions ARC hands to POI, without the ones it evaluates itself. */
  private static Set<String> poiEvaluatedFunctions() {
    var names = new TreeSet<>(FunctionCatalog.excelFunctions());
    names.removeAll(Functions.arcFunctionNames());
    names.removeAll(ExpressionRuntime.lazyFunctionNames());
    return names;
  }

  /**
   * Whether POI answers the same for an array in the parameter as for that array's first cell, for
   * every probe and every combination of 1 and 2 in the (first four) other parameters.
   */
  private static boolean firstCellDecides(FunctionMetadata metadata, int parameter) {
    Function function = FunctionEval.getBasicFunction(metadata.getIndex());
    int count = Math.max(metadata.getMinParams(), parameter + 1);
    int varied = Math.min(count - 1, 4);
    for (Probe probe : PROBES) {
      for (int combination = 0; combination < 1 << varied; combination++) {
        Object[] args = new Object[count];
        int position = 0;
        for (int index = 0; index < count; index++) {
          if (index == parameter) continue;
          args[index] = position < varied && (combination >> position & 1) == 1 ? 2 : 1;
          position++;
        }
        args[parameter] = probe.array();
        String withArray = outcome(function, args);
        args[parameter] = probe.firstCell();
        if (!withArray.equals(outcome(function, args))) return false;
      }
    }
    return true;
  }

  private static String outcome(Function function, Object[] args) {
    ValueEval[] values =
        Arrays.stream(args).map(ExcelFunctionAdapter::value).toArray(ValueEval[]::new);
    try {
      return describe(function.evaluate(values, 0, 0));
    } catch (RuntimeException error) {
      return "throws " + error.getClass().getSimpleName();
    }
  }

  private static String describe(ValueEval value) {
    if (value instanceof ErrorEval error) return error.getErrorString();
    if (value instanceof NumberEval number) return "number " + number.getNumberValue();
    if (value instanceof StringEval text) return "text " + text.getStringValue();
    if (value instanceof BoolEval flag) return "boolean " + flag.getBooleanValue();
    if (value instanceof RefEval reference)
      return describe(reference.getInnerValueEval(reference.getFirstSheetIndex()));
    if (value instanceof AreaEval area) {
      var cells = new ArrayList<String>();
      for (int row = 0; row < area.getHeight(); row++)
        for (int column = 0; column < area.getWidth(); column++)
          cells.add(describe(area.getRelativeValue(row, column)));
      return "area " + area.getHeight() + "x" + area.getWidth() + " " + cells;
    }
    return value == null ? "null" : value.getClass().getSimpleName();
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

  @Test
  void reptMeasuresTheTextPoiRepeats() {
    var blank = new HashMap<String, Object>();
    blank.put("blank", null);
    // These failed with "REPT result exceeds string limit": the check measured BigDecimal.toString
    // ("1E+2", "0.3333333333333333333333333333333333", "null") instead of POI's text.
    for (String expression :
        List.of(
            "$LEN($REPT(1E+2, 600))",
            "$LEN($REPT($ROUND(149, -2), 600))",
            "$LEN($REPT($TO_NUMBER(\"1e2\"), 600))",
            "$LEN($REPT(0.50, 600))"))
      assertThat(eval(expression)).as(expression).isEqualTo(new BigDecimal("1800"));
    assertThat(eval("$LEN($REPT(1 / 3, 100))")).isEqualTo(new BigDecimal("1700"));
    assertThat(eval("$LEN($REPT(blank, 600))", blank)).isEqualTo(BigDecimal.ZERO);
    // "1E+10" measured 5 characters, so POI built 4,389 before the generic string bound.
    assertThatThrownBy(() -> eval("$REPT(1e10, 399)"))
        .hasMessage("REPT result exceeds string limit");
  }
}
