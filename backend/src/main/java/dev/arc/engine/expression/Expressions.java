package dev.arc.engine.expression;

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

  /** Immutable compiled code; each evaluation owns its scope and operation budget. */
  public static final class Compiled {
    private final Expr expression;
    private final Set<String> variables;

    private Compiled(Expr expression, Set<String> variables) {
      this.expression = expression;
      this.variables = Set.copyOf(variables);
    }

    public Set<String> variables() {
      return variables;
    }

    public Object evaluate(Map<String, Object> scope) {
      return bounded(expression.eval(new ExpressionRuntime.Context(scope)));
    }
  }

  public static Compiled compile(String source) {
    if (source == null || source.isBlank()) throw ArcException.invalid("Expression is required");
    if (source.length() > 2000) throw ArcException.invalid("Expression exceeds 2,000 characters");
    var parser = new ExpressionParser(source.trim());
    Expr expression = parser.parse(0);
    if (!parser.peek().equals("<end>"))
      throw ArcException.invalid("Unexpected token: " + parser.peek());
    return new Compiled(expression, parser.variables());
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
    if (depth > 8 || ++count[0] > 10000)
      throw ArcException.invalid("Value exceeds collection depth or size limit");
    if (value instanceof BigDecimal n && (n.precision() > 100 || Math.abs((long) n.scale()) > 100))
      throw ArcException.invalid("Number exceeds supported precision or magnitude");
    if (value instanceof Number n && !Double.isFinite(n.doubleValue()))
      throw ArcException.invalid("Number must be finite");
    if (value instanceof String s && s.length() > 2000)
      throw ArcException.invalid("String exceeds 2,000 characters");
    if (value instanceof List<?> xs) {
      if (xs.size() > 1000) throw ArcException.invalid("Array exceeds 1,000 items");
      for (Object x : xs) bound(x, depth + 1, count);
    }
    if (value instanceof Map<?, ?> m) {
      if (m.size() > 1000) throw ArcException.invalid("Object exceeds 1,000 fields");
      for (var e : m.entrySet()) {
        bound(e.getKey(), depth + 1, count);
        bound(e.getValue(), depth + 1, count);
      }
    }
  }

  public static boolean equal(Object a, Object b) {
    return a instanceof Number && b instanceof Number
        ? number(a).compareTo(number(b)) == 0
        : Objects.equals(a, b);
  }

  private static String type(Object o) {
    return o == null ? "null" : o.getClass().getSimpleName();
  }
}
