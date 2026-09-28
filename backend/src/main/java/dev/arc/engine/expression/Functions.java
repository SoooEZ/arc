package dev.arc.engine.expression;

import dev.arc.engine.Limits;
import dev.arc.engine.ValueText;
import dev.arc.error.ArcException;
import java.math.*;
import java.util.*;
import java.util.function.Function;

/** Stable expression-facing facade: decimal built-ins, catalog, and Excel adapter. */
public final class Functions {
  public record Entry(
      String name,
      String category,
      String signature,
      String description,
      String snippet,
      boolean supported,
      String origin) {}

  /**
   * Decimal places, either side of the point, that {@code ROUND}, {@code ROUNDDOWN} and {@code
   * ROUNDUP} accept.
   */
  static final int MAX_ROUND_DIGITS = 12;

  /**
   * Functions ARC evaluates from already evaluated arguments. Lazy and collection functions are
   * evaluated by {@link ExpressionRuntime}; every other name is an Excel function for POI.
   */
  private static final Map<String, Function<List<Object>, Object>> ARC_FUNCTIONS = arcFunctions();

  public static List<Entry> catalog() {
    return FunctionCatalog.catalog();
  }

  public static void arity(String name, int count) {
    FunctionCatalog.arity(name, count);
  }

  public static Object call(String name, List<Object> args) {
    return call(name, args, new RangeValues());
  }

  /** Calls with the evaluation's range values, so POI sees each unchanged range converted once. */
  static Object call(String name, List<Object> args, RangeValues ranges) {
    var function = ARC_FUNCTIONS.get(name);
    return function == null
        ? ExcelFunctionAdapter.evaluate(name, args, ranges)
        : function.apply(args);
  }

  /** Names that ARC, not POI, evaluates from evaluated arguments. */
  static Set<String> arcFunctionNames() {
    return ARC_FUNCTIONS.keySet();
  }

  private static Map<String, Function<List<Object>, Object>> arcFunctions() {
    var functions = new HashMap<String, Function<List<Object>, Object>>();
    for (DecimalAggregate aggregate : DecimalAggregate.values())
      functions.put(aggregate.name(), args -> aggregate.apply(numbers(args)));
    functions.put("OBJECT", DataFunctions::object);
    functions.put("MERGE", DataFunctions::merge);
    functions.put("TO_NUMBER", args -> DataFunctions.number(args.getFirst()));
    functions.put("TO_STRING", args -> DataFunctions.text(args.getFirst()));
    functions.put("TO_BOOLEAN", args -> DataFunctions.bool(args.getFirst()));
    functions.put("ABS", args -> Expressions.number(args.getFirst()).abs());
    functions.put(
        "FLOOR", args -> Expressions.number(args.getFirst()).setScale(0, RoundingMode.FLOOR));
    functions.put(
        "CEIL", args -> Expressions.number(args.getFirst()).setScale(0, RoundingMode.CEILING));
    functions.put("ROUND", args -> round(args, RoundingMode.HALF_UP));
    functions.put("ROUNDDOWN", args -> round(args, RoundingMode.DOWN));
    functions.put("ROUNDUP", args -> round(args, RoundingMode.UP));
    functions.put("NOT", args -> !Expressions.bool(args.getFirst()));
    functions.put("XOR", args -> args.stream().filter(Expressions::bool).count() % 2 == 1);
    functions.put("CONTAINS", args -> contains(args.get(0), args.get(1)));
    functions.put("CONCAT", Functions::concat);
    functions.put("GET", args -> get(args.get(0), segments("GET", args.get(1)), fallback(args)));
    functions.put("PLUCK", Functions::pluck);
    return Map.copyOf(functions);
  }

  /** The numbers an aggregate receives: its arguments with nested arrays flattened. */
  private static List<BigDecimal> numbers(List<Object> args) {
    return flatten(args).stream().map(Expressions::number).toList();
  }

  private static BigDecimal round(List<Object> args, RoundingMode mode) {
    int scale = 0;
    try {
      if (args.size() > 1) scale = Expressions.number(args.get(1)).intValueExact();
    } catch (ArithmeticException e) {
      throw ArcException.invalid("Round precision must be an integer");
    }
    if (scale < -MAX_ROUND_DIGITS || scale > MAX_ROUND_DIGITS)
      throw ArcException.invalid(
          "Round precision must be -" + MAX_ROUND_DIGITS + " to " + MAX_ROUND_DIGITS);
    return Expressions.number(args.getFirst()).setScale(scale, mode);
  }

  /**
   * Array membership uses value equality; text search uses the canonical text of scalars, so a
   * number matches as {@code $TO_STRING} writes it. Null is no text: it contains nothing and is
   * never contained, rather than being searched as the word "null".
   */
  private static boolean contains(Object searched, Object value) {
    if (searched instanceof List<?> items) {
      for (Object item : items) {
        if (Expressions.equal(item, value)) return true;
      }
      return false;
    }
    if (!ValueText.isScalar(searched))
      throw ArcException.invalid("CONTAINS searches text or an array");
    if (!ValueText.isScalar(value))
      throw ArcException.invalid("CONTAINS can only search text for a scalar value");
    if (searched == null || value == null) return false;
    return ValueText.text(searched).contains(ValueText.text(value));
  }

  /** Joins scalars in their canonical text; nulls add nothing and objects cannot be joined. */
  private static String concat(List<Object> args) {
    var joined = new StringBuilder();
    for (Object value : flatten(args)) {
      if (!ValueText.isScalar(value))
        throw ArcException.invalid("CONCAT joins scalar values or arrays of scalars");
      if (value != null) joined.append(ValueText.text(value));
    }
    return joined.toString();
  }

  private static List<Object> pluck(List<Object> args) {
    List<String> path = segments("PLUCK", args.get(1));
    Object fallback = fallback(args);
    var values = new ArrayList<Object>();
    for (Object item : array(args.getFirst())) values.add(get(item, path, fallback));
    return values;
  }

  /**
   * The segments of a path. Dotted text keeps every segment, so "name." and "." have an empty one
   * that misses (String.split would drop it and read the prefix). A number names one array index or
   * field, and equal numbers name the same one: 1.5 is the field "1.5", never a nested path.
   */
  private static List<String> segments(String function, Object path) {
    if (path == null || !ValueText.isScalar(path))
      throw ArcException.invalid(function + " needs a text or number path");
    if (path instanceof String text) return List.of(text.split("\\.", -1));
    return List.of(ValueText.key(path));
  }

  private static Object fallback(List<Object> args) {
    return args.size() == 3 ? args.get(2) : null;
  }

  public static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw ArcException.invalid("Expected an array");
    return list;
  }

  /**
   * An array index: one to six ASCII digits (leading zeros allowed, as {@code \\d{1,6}} read them),
   * parsed once; -1 for any other segment. A character loop, because a regex compiled per access.
   */
  static int arrayIndex(String part) {
    if (part.isEmpty() || part.length() > 6) return -1;
    int index = 0;
    for (int at = 0; at < part.length(); at++) {
      char c = part.charAt(at);
      if (c < '0' || c > '9') return -1;
      index = index * 10 + (c - '0');
    }
    return index;
  }

  /** Follows {@code segments} into nested objects and arrays; a missing one gives the fallback. */
  public static Object get(Object value, List<String> segments, Object fallback) {
    for (String part : segments) {
      if (value instanceof Map<?, ?> m && m.containsKey(part)) value = m.get(part);
      else if (value instanceof List<?> a) {
        int index = arrayIndex(part);
        if (index < 0 || index >= a.size()) return fallback;
        value = a.get(index);
      } else return fallback;
    }
    return value;
  }

  private static List<Object> flatten(List<?> args) {
    var out = new ArrayList<Object>();
    for (Object x : args) {
      if (x instanceof List<?> a) out.addAll(flatten(a));
      else out.add(x);
      if (out.size() > Limits.MAX_VALUE_ELEMENTS)
        throw ArcException.invalid("Too many array values");
    }
    return out;
  }

  private Functions() {}
}
