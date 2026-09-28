package dev.arc.engine.expression;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.*;

/**
 * A bounded expression language with decimal arithmetic and a function registry. No reflection,
 * scripting, IO, or arbitrary calls.
 */
public final class Expressions {
  public static final MathContext MATH = MathContext.DECIMAL128;

  private Expressions() {}

  @FunctionalInterface
  interface Expr {
    Object eval(ExpressionRuntime.Context context);
  }

  public record FormulaCall(String id, int version, int argumentCount) {}

  /**
   * Host capability for a reached published Formula call; arguments retain explicit nulls. The
   * result is used as returned, without bounding it again, so the caller sees what a Reference node
   * would store: the host bounds each value the called rule returns.
   */
  @FunctionalInterface
  public interface FormulaCaller {
    Object call(FormulaCall formula, List<Object> arguments);

    static FormulaCaller unavailable() {
      return (formula, arguments) -> {
        throw ArcException.invalid("Published Formula calls need a rule execution context");
      };
    }
  }

  /** Immutable compiled code; each evaluation owns its scope and operation budget. */
  public static final class Compiled {
    private final Expr expression;
    private final Set<String> variables;
    private final List<FormulaCall> formulaCalls;

    private Compiled(Expr expression, Set<String> variables, List<FormulaCall> formulaCalls) {
      this.expression = expression;
      this.variables = Collections.unmodifiableSet(new LinkedHashSet<>(variables));
      this.formulaCalls = List.copyOf(formulaCalls);
    }

    /**
     * Free variables in the order they first appear in the source. Callers that resolve or read
     * dependencies one by one follow this order, so it must not depend on hashing.
     */
    public Set<String> variables() {
      return variables;
    }

    public List<FormulaCall> formulaCalls() {
      return formulaCalls;
    }

    public Object evaluate(Map<String, Object> scope) {
      return evaluate(scope, ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS));
    }

    public Object evaluate(Map<String, Object> scope, ExecutionDeadline deadline) {
      return evaluate(scope, deadline, FormulaCaller.unavailable());
    }

    public Object evaluate(
        Map<String, Object> scope, ExecutionDeadline deadline, FormulaCaller formulas) {
      deadline.check();
      Object result =
          bounded(expression.eval(new ExpressionRuntime.Context(scope, deadline, formulas)));
      deadline.check();
      return result;
    }
  }

  public static Compiled compile(String source) {
    if (source == null || source.isBlank()) throw ArcException.invalid("Expression is required");
    if (source.length() > Limits.MAX_EXPRESSION_CHARACTERS)
      throw ArcException.invalid(
          "Expression exceeds " + Limits.format(Limits.MAX_EXPRESSION_CHARACTERS) + " characters");
    var parser = new ExpressionParser(source.trim());
    Expr expression = parser.parse(0);
    if (!parser.peek().equals("<end>"))
      throw ArcException.invalid("Unexpected token: " + parser.peek());
    return new Compiled(expression, parser.variables(), parser.formulaCalls());
  }

  public static Object evaluate(String source, Map<String, Object> scope) {
    return compile(source).evaluate(scope);
  }

  public static BigDecimal number(Object value) {
    if (!(value instanceof Number))
      throw ArcException.invalid("Expected a number, got " + type(value));
    try {
      return (BigDecimal)
          bounded(value instanceof BigDecimal b ? b : new BigDecimal(value.toString()));
    } catch (NumberFormatException e) {
      throw ArcException.invalid("Invalid numeric value");
    }
  }

  public static boolean bool(Object value) {
    if (!(value instanceof Boolean b))
      throw ArcException.invalid("Expected a boolean, got " + type(value));
    return b;
  }

  public static Object bounded(Object value) {
    bound(value, 0, new int[] {0});
    return value;
  }

  private static void bound(Object value, int depth, int[] count) {
    if (depth > Limits.MAX_VALUE_DEPTH || ++count[0] > Limits.MAX_VALUE_ELEMENTS)
      throw ArcException.invalid("Value exceeds collection depth or size limit");
    if (value instanceof BigDecimal n) {
      // The limits apply to the number, not to how it is written: PostgreSQL JSONB stores 1E+100
      // as a 101-digit integer. Accepted decimals stay below 1E+201 and so are finite as doubles;
      // that conversion is slow for 34-digit quotients, and every operand passes through here.
      if (exceedsDecimalLimits(n) && exceedsDecimalLimits(n.stripTrailingZeros()))
        throw ArcException.invalid("Number exceeds supported precision or magnitude");
    } else if (value instanceof Number n && !Double.isFinite(n.doubleValue())) {
      throw ArcException.invalid("Number must be finite");
    }
    if (value instanceof String s && s.length() > Limits.MAX_STRING_CHARACTERS)
      throw ArcException.invalid(
          "String exceeds " + Limits.format(Limits.MAX_STRING_CHARACTERS) + " characters");
    if (value instanceof List<?> xs) {
      if (xs.size() > Limits.MAX_COLLECTION_ITEMS)
        throw ArcException.invalid(
            "Array exceeds " + Limits.format(Limits.MAX_COLLECTION_ITEMS) + " items");
      for (Object x : xs) bound(x, depth + 1, count);
    }
    if (value instanceof Map<?, ?> m) {
      if (m.size() > Limits.MAX_COLLECTION_ITEMS)
        throw ArcException.invalid(
            "Object exceeds " + Limits.format(Limits.MAX_COLLECTION_ITEMS) + " fields");
      for (var e : m.entrySet()) {
        bound(e.getKey(), depth + 1, count);
        bound(e.getValue(), depth + 1, count);
      }
    }
  }

  private static boolean exceedsDecimalLimits(BigDecimal number) {
    return number.precision() > Limits.MAX_NUMBER_PRECISION
        || Math.abs((long) number.scale()) > Limits.MAX_NUMBER_SCALE;
  }

  /**
   * ARC value equality, used by {@code ==}, {@code !=}, {@code $SWITCH}, {@code $CONTAINS} and
   * Switch nodes. Numbers are equal when their decimal values are ({@code 1 == 1.0}), including
   * inside arrays and objects: arrays compare element by element in order and objects compare the
   * same field names. Other values need the same type, so {@code 1} never equals {@code "1"}.
   */
  public static boolean equal(Object a, Object b) {
    if (a instanceof Number && b instanceof Number) return number(a).compareTo(number(b)) == 0;
    if (a instanceof List<?> left && b instanceof List<?> right) return sameItems(left, right);
    if (a instanceof Map<?, ?> left && b instanceof Map<?, ?> right) return sameFields(left, right);
    return Objects.equals(a, b);
  }

  private static boolean sameItems(List<?> left, List<?> right) {
    if (left.size() != right.size()) return false;
    Iterator<?> others = right.iterator();
    for (Object item : left) {
      if (!equal(item, others.next())) return false;
    }
    return true;
  }

  private static boolean sameFields(Map<?, ?> left, Map<?, ?> right) {
    if (left.size() != right.size()) return false;
    for (var field : left.entrySet()) {
      if (!right.containsKey(field.getKey())) return false;
      if (!equal(field.getValue(), right.get(field.getKey()))) return false;
    }
    return true;
  }

  private static String type(Object o) {
    return o == null ? "null" : o.getClass().getSimpleName();
  }
}
