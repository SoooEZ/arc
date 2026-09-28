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
    var function = ARC_FUNCTIONS.get(name);
    return function == null ? ExcelFunctionAdapter.evaluate(name, args) : function.apply(args);
  }

  /** Names that ARC, not POI, evaluates from evaluated arguments. */
  static Set<String> arcFunctionNames() {
    return ARC_FUNCTIONS.keySet();
  }

  private static Map<String, Function<List<Object>, Object>> arcFunctions() {
    var functions = new HashMap<String, Function<List<Object>, Object>>();
    for (String name : BuiltinFunctionCatalog.DECIMAL_AGGREGATES)
      functions.put(name, args -> aggregate(name, args));
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
    functions.put("GET", args -> get(args.get(0), path("GET", args.get(1)), fallback(args)));
    functions.put("PLUCK", Functions::pluck);
    return Map.copyOf(functions);
  }

  private static Object aggregate(String name, List<Object> args) {
    List<BigDecimal> numbers = flatten(args).stream().map(Expressions::number).toList();
    if (name.equals("COUNT")) return BigDecimal.valueOf(numbers.size());
    if (numbers.isEmpty() && !name.equals("SUM") && !name.equals("MUL"))
      throw ArcException.invalid(name + " requires values");
    return switch (name) {
      case "MIN" -> numbers.stream().min(BigDecimal::compareTo).orElseThrow();
      case "MAX" -> numbers.stream().max(BigDecimal::compareTo).orElseThrow();
      case "MUL" ->
          numbers.stream().reduce(BigDecimal.ONE, (a, b) -> a.multiply(b, Expressions.MATH));
      default -> {
        var sum = numbers.stream().reduce(BigDecimal.ZERO, (a, b) -> a.add(b, Expressions.MATH));
        yield name.equals("AVG") || name.equals("AVERAGE")
            ? sum.divide(BigDecimal.valueOf(numbers.size()), Expressions.MATH)
            : sum;
      }
    };
  }

  private static BigDecimal round(List<Object> args, RoundingMode mode) {
    int scale = 0;
    try {
      if (args.size() > 1) scale = Expressions.number(args.get(1)).intValueExact();
    } catch (ArithmeticException e) {
      throw ArcException.invalid("Round precision must be an integer");
    }
    if (scale < -12 || scale > 12) throw ArcException.invalid("Round precision must be -12 to 12");
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
    String path = path("PLUCK", args.get(1));
    Object fallback = fallback(args);
    var values = new ArrayList<Object>();
    for (Object item : array(args.getFirst())) values.add(get(item, path, fallback));
    return values;
  }

  /** A field path, or a number naming an array index or field; equal numbers name the same one. */
  private static String path(String function, Object path) {
    if (path == null || !ValueText.isScalar(path))
      throw ArcException.invalid(function + " needs a text or number path");
    return ValueText.key(path);
  }

  private static Object fallback(List<Object> args) {
    return args.size() == 3 ? args.get(2) : null;
  }

  public static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw ArcException.invalid("Expected an array");
    return list;
  }

  public static Object get(Object value, String path, Object fallback) {
    for (String part : path.split("\\.")) {
      if (value instanceof Map<?, ?> m && m.containsKey(part)) value = m.get(part);
      else if (value instanceof List<?> a
          && part.matches("\\d{1,6}")
          && Integer.parseInt(part) < a.size()) value = a.get(Integer.parseInt(part));
      else return fallback;
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
