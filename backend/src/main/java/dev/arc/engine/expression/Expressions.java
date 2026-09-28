package dev.arc.engine.expression;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.engine.ValueBounds;
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
      return deadline.within(
          () -> bounded(expression.eval(new ExpressionRuntime.Context(scope, deadline, formulas))));
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

  /** The bounded decimal value of a number ({@link ValueBounds#number}). */
  public static BigDecimal number(Object value) {
    return ValueBounds.number(value);
  }

  public static boolean bool(Object value) {
    if (!(value instanceof Boolean b))
      throw ArcException.invalid("Expected a boolean, got " + ValueBounds.typeOf(value));
    return b;
  }

  /** The value once it is within every bound ({@link ValueBounds#bounded}). */
  public static Object bounded(Object value) {
    return ValueBounds.bounded(value);
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
}
