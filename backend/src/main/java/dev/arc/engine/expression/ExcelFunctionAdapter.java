package dev.arc.engine.expression;

import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import java.util.function.Supplier;
import org.apache.poi.ss.formula.CacheAreaEval;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.formula.function.FunctionMetadata;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;
import org.apache.poi.ss.formula.ptg.Ptg;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.util.LocaleUtil;

/** Boundary between bounded ARC values and Apache POI's workbook-style value model. */
final class ExcelFunctionAdapter {
  /** Functions that count or measure the range in their first argument. */
  private static final Set<String> MEASURES_OF_FIRST_RANGE =
      Set.of("ROWS", "COLUMNS", "COUNTBLANK", "COUNTIF", "SUMIF");

  /** Functions that look a value up in the range in their second argument. */
  private static final Set<String> LOOKUPS_IN_SECOND_RANGE =
      Set.of("MATCH", "VLOOKUP", "HLOOKUP", "LOOKUP");

  /** COMBIN's largest n, in either direction. */
  static final int MAX_COMBIN_N = 10_000;

  /** The decimal places FIXED, DOLLAR and TRUNC accept, either side of the decimal point. */
  static final int MAX_DECIMAL_PLACES = 100;

  /**
   * The values MODE may compare: the most whose pairs stay within {@link
   * ExcelMatchingWork#MAX_STEPS} comparisons (4,472).
   */
  static final int MAX_MODE_VALUES =
      (int) ((1 + Math.sqrt(1 + 8.0 * ExcelMatchingWork.MAX_STEPS)) / 2);

  static {
    // DateUtil fixes the locale of its date formatter when it loads, so whichever call loaded it
    // first decided how month names read. Load it under ARC's settings.
    inExcelLocale(() -> DateUtil.isValidExcelDate(0));
  }

  /** A function's parameter, by zero-based index. */
  record ReferenceParameter(String function, int index) {}

  /**
   * Reference-class parameters that Excel reads as one value. POI's metadata marks them as
   * references, so the value-class check does not cover them, and POI would use the first cell of
   * an array there ({@code $VLOOKUP(2, table, [3, 2], false)} read column 3): the index of VLOOKUP
   * and HLOOKUP, MATCH's match type, the field of every database function, and T's value, which
   * Excel would spill and ARC cannot.
   */
  static final Set<ReferenceParameter> SINGLE_VALUE_REFERENCES = singleValueReferences();

  private static Set<ReferenceParameter> singleValueReferences() {
    var parameters = new HashSet<ReferenceParameter>();
    parameters.add(new ReferenceParameter("VLOOKUP", 2));
    parameters.add(new ReferenceParameter("HLOOKUP", 2));
    parameters.add(new ReferenceParameter("MATCH", 2));
    parameters.add(new ReferenceParameter("T", 0));
    for (String function : ExcelMatchingWork.DATABASE_FUNCTIONS)
      parameters.add(new ReferenceParameter(function, 1));
    return Set.copyOf(parameters);
  }

  static Object evaluate(String name, List<Object> args) {
    return evaluate(name, args, new RangeValues());
  }

  /** Evaluates with the calling evaluation's range values, so a repeated range converts once. */
  static Object evaluate(String name, List<Object> args, RangeValues ranges) {
    try {
      FunctionMetadata metadata = FunctionMetadataRegistry.getFunctionByName(name);
      checkSingleValues(name, metadata, args);
      if (args.stream().anyMatch(ExcelFunctionAdapter::isEmptyRange))
        return emptyRangeResult(name, args);
      checkArgumentBounds(name, args);
      ExcelDateText.refuseDatesWithoutYear(name, args);
      ValueEval[] values = args.stream().map(ranges::value).toArray(ValueEval[]::new);
      ExcelMatchingWork.checkMatchingWork(name, args);
      return converted(inExcelLocale(() -> calculate(name, metadata, values)), name);
    } catch (ArcException e) {
      throw e;
    } catch (RuntimeException e) {
      throw ArcException.invalid(name + ": invalid arguments or unsupported workbook context");
    }
  }

  /**
   * POI's reading of a {@code $CHOOSE} index, which ARC evaluates lazily: numbers round down,
   * numeric text and booleans convert, and anything else is #VALUE!.
   */
  static int choiceIndex(Object index) {
    if (index instanceof List<?>) throw notSingleValue("CHOOSE", 0);
    // Text reads as a date or a number here, so the index gets ARC's locale like every POI call.
    return inExcelLocale(
        () -> {
          try {
            return OperandResolver.coerceValueToInt(value(index));
          } catch (EvaluationException error) {
            throw excelError("CHOOSE", error.getErrorEval());
          }
        });
  }

  private static ValueEval calculate(String name, FunctionMetadata metadata, ValueEval[] values) {
    if (name.equals("TEXT")) return ExcelText.evaluate(values[0], values[1]);
    return FunctionEval.getBasicFunction(metadata.getIndex()).evaluate(values, 0, 0);
  }

  /**
   * POI reads the locale and time zone for currency symbols, number and date text, and case
   * conversion from thread-local settings that default to the JVM's. Pinning them makes a published
   * rule return the same text on every host; they are cleared again after the call.
   */
  private static <T> T inExcelLocale(Supplier<T> calculation) {
    LocaleUtil.setUserLocale(Locale.US);
    LocaleUtil.setUserTimeZone(LocaleUtil.TIMEZONE_UTC);
    try {
      return calculation.get();
    } finally {
      LocaleUtil.resetUserLocale();
      LocaleUtil.resetUserTimeZone();
    }
  }

  /**
   * Parameters of Excel's value class, and the listed reference-class parameters, take one value.
   * POI would quietly use the first cell of an array there ({@code $SQRT([4, 9])} was 2), so arrays
   * may only reach range parameters.
   */
  private static void checkSingleValues(String name, FunctionMetadata metadata, List<Object> args) {
    byte[] parameterClasses = metadata.getParameterClassCodes();
    for (int index = 0; index < args.size() && parameterClasses.length > 0; index++) {
      // Variable-length functions repeat the class of their last declared parameter.
      byte parameterClass = parameterClasses[Math.min(index, parameterClasses.length - 1)];
      boolean singleValue =
          parameterClass == Ptg.CLASS_VALUE
              || SINGLE_VALUE_REFERENCES.contains(new ReferenceParameter(name, index));
      if (singleValue && args.get(index) instanceof List<?>) throw notSingleValue(name, index);
    }
  }

  private static ArcException notSingleValue(String name, int index) {
    return ArcException.invalid(
        name + ": argument " + (index + 1) + " must be a single value, not an array");
  }

  private static boolean isEmptyRange(Object value) {
    return value instanceof List<?> items && items.isEmpty();
  }

  /**
   * Excel has no empty range, and POI would read [] as one blank cell ({@code $ROWS([])} was 1).
   * Counting or measuring nothing is zero and looking something up in nothing is #N/A; any other
   * empty range is rejected.
   */
  private static Object emptyRangeResult(String name, List<Object> args) {
    if (MEASURES_OF_FIRST_RANGE.contains(name) && isEmptyRange(args.getFirst()))
      return BigDecimal.ZERO;
    if (name.equals("COUNTA")) {
      var values = args.stream().filter(value -> !isEmptyRange(value)).toList();
      return values.isEmpty() ? BigDecimal.ZERO : evaluate(name, values);
    }
    if (LOOKUPS_IN_SECOND_RANGE.contains(name) && isEmptyRange(args.get(1)))
      throw excelError(name, ErrorEval.NA);
    throw ArcException.invalid(name + ": Excel ranges cannot be empty");
  }

  /** Arguments that would make POI build values larger than ARC accepts, or work unboundedly. */
  private static void checkArgumentBounds(String name, List<Object> args) {
    if (name.equals("COMBIN") && beyond(args.getFirst(), MAX_COMBIN_N))
      throw ArcException.invalid("COMBIN supports n up to " + Limits.format(MAX_COMBIN_N));
    if (Set.of("FIXED", "DOLLAR", "TRUNC").contains(name)
        && args.size() > 1
        && beyond(args.get(1), MAX_DECIMAL_PLACES))
      throw ArcException.invalid(
          name + ": decimal places must be -" + MAX_DECIMAL_PLACES + " to " + MAX_DECIMAL_PLACES);
    if (name.equals("REPT")) checkRepeatedLength(args);
    if (name.equals("MODE")) checkPairwiseWork(args);
  }

  /** Whether POI would read the argument as a number beyond the bound, in either direction. */
  private static boolean beyond(Object argument, int bound) {
    OptionalDouble number = poiNumber(argument);
    return number.isPresent() && Math.abs(number.getAsDouble()) > bound;
  }

  /**
   * The number POI reads from a single-value argument inside the function: numeric text, booleans
   * and blanks count, so a bound never refuses an argument that the function accepts. Empty when
   * POI reads no number there; the call then fails with POI's own error.
   */
  private static OptionalDouble poiNumber(Object argument) {
    return inExcelLocale(
        () -> {
          try {
            return OptionalDouble.of(OperandResolver.coerceValueToDouble(value(argument)));
          } catch (EvaluationException notANumber) {
            return OptionalDouble.empty();
          }
        });
  }

  /** REPT must not build a string that the value bounds reject afterwards. */
  private static void checkRepeatedLength(List<Object> args) {
    OptionalDouble count = poiNumber(args.get(1));
    if (count.isEmpty()) return;
    if (count.getAsDouble() < 0 || count.getAsDouble() > Limits.MAX_STRING_CHARACTERS)
      throw ArcException.invalid("REPT result exceeds string limit");
    // Measure the text POI repeats ("" for a blank, "100" for 1E+2), count times truncated to an
    // int as POI does; BigDecimal.toString refused $REPT(1E+2, 600) and let $REPT(1e10, 399)
    // through.
    String text = OperandResolver.coerceValueToString(value(args.getFirst()));
    if ((long) text.length() * (int) count.getAsDouble() > Limits.MAX_STRING_CHARACTERS)
      throw ArcException.invalid("REPT result exceeds string limit");
  }

  /**
   * POI's MODE compares every pair of its values in one call that the deadline cannot interrupt: 30
   * arrays of 9,801 cells are 4.3e10 comparisons, half a minute of CPU for a 1 KB request. Counting
   * every cell over-estimates the numbers POI compares, so the bound is safe.
   */
  private static void checkPairwiseWork(List<Object> args) {
    long values = 0;
    for (Object argument : args) values += cells(argument);
    if (values > MAX_MODE_VALUES)
      throw ArcException.invalid(
          "MODE compares every pair of values and accepts at most "
              + Limits.format(MAX_MODE_VALUES)
              + " values");
  }

  private static long cells(Object argument) {
    if (!(argument instanceof List<?> items)) return 1;
    long count = 0;
    for (Object item : items) count += item instanceof List<?> row ? row.size() : 1;
    return count;
  }

  static ValueEval value(Object x) {
    if (x == null) return BlankEval.instance;
    if (x instanceof Number n) return new NumberEval(n.doubleValue());
    if (x instanceof Boolean b) return BoolEval.valueOf(b);
    if (x instanceof String s) return new StringEval(s);
    if (x instanceof List<?> a) {
      if (a.isEmpty()) throw ArcException.invalid("Excel ranges cannot be empty");
      int cols = a.getFirst() instanceof List<?> row ? row.size() : 1;
      if (cols == 0) throw ArcException.invalid("Excel ranges cannot contain empty rows");
      var vals = new ArrayList<ValueEval>();
      for (Object r : a) {
        List<?> row = r instanceof List<?> l ? l : Collections.singletonList(r);
        if (row.size() != cols) throw ArcException.invalid("Excel ranges must be rectangular");
        for (Object v : row) {
          if (v instanceof List<?> || v instanceof Map<?, ?>)
            throw ArcException.invalid("Excel range cells must be scalars");
          vals.add(value(v));
        }
      }
      return new CacheAreaEval(0, 0, a.size() - 1, cols - 1, vals.toArray(ValueEval[]::new));
    }
    throw ArcException.invalid("Excel functions require scalars or rectangular arrays");
  }

  private static Object converted(ValueEval result, String name) {
    if (result instanceof ErrorEval error) throw excelError(name, error);
    if (result instanceof BoolEval b) return b.getBooleanValue();
    if (result instanceof NumberEval n) {
      if (!Double.isFinite(n.getNumberValue()))
        throw ArcException.invalid(name + ": non-finite result");
      return plainDecimal(n.getNumberValue());
    }
    if (result instanceof StringEval s) return s.getStringValue();
    if (result instanceof BlankEval) return null;
    if (result instanceof RefEval r)
      return converted(r.getInnerValueEval(r.getFirstSheetIndex()), name);
    if (result instanceof AreaEval area) {
      if (area.getHeight() > Limits.MAX_COLLECTION_ITEMS
          || area.getWidth() > Limits.MAX_COLLECTION_ITEMS
          || (long) area.getHeight() * area.getWidth() > Limits.MAX_VALUE_ELEMENTS)
        throw ArcException.invalid("Excel result exceeds array limits");
      if (area.getHeight() == 1 && area.getWidth() == 1)
        return converted(area.getRelativeValue(0, 0), name);
      var rows = new ArrayList<Object>();
      for (int y = 0; y < area.getHeight(); y++) {
        var row = new ArrayList<Object>();
        for (int x = 0; x < area.getWidth(); x++)
          row.add(converted(area.getRelativeValue(y, x), name));
        rows.add(row);
      }
      return Expressions.bounded(rows);
    }
    throw ArcException.invalid(name + ": result requires workbook context");
  }

  /**
   * POI calculates in doubles; ARC keeps the shortest decimal without a negative scale, so 20 comes
   * back as 20 rather than 2E+1 and prints the same way everywhere.
   */
  private static BigDecimal plainDecimal(double value) {
    BigDecimal number = BigDecimal.valueOf(value).stripTrailingZeros();
    return number.scale() < 0 ? number.setScale(0) : number;
  }

  /** #N/A keeps its own kind so ISNA and ISERR never depend on the message text. */
  private static ArcException excelError(String name, ErrorEval error) {
    String message = name + ": " + error.getErrorString();
    if (error.getErrorCode() == ErrorEval.NA.getErrorCode())
      return ArcException.notAvailable(message);
    return ArcException.invalid(message);
  }

  private ExcelFunctionAdapter() {}
}
