package dev.arc.engine;

import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import java.math.BigDecimal;

/**
 * Canonical text of scalar values: null, strings, numbers and booleans. Numbers use plain decimal
 * notation, never scientific notation such as {@code 2E+1}, and must satisfy the value bounds of
 * {@link Expressions#number(Object)}. Arrays and objects have no text form here; callers that
 * accept them decide how to reject or encode them first.
 */
public final class ValueText {
  private ValueText() {}

  public static boolean isScalar(Object value) {
    return value == null
        || value instanceof String
        || value instanceof Number
        || value instanceof Boolean;
  }

  /**
   * The {@code $TO_STRING} conversion. Null stays null, strings are unchanged, numbers keep their
   * scale ({@code 20.0} becomes {@code "20.0"}) and booleans become {@code "true"} or {@code
   * "false"}.
   */
  public static String text(Object scalar) {
    if (scalar == null || scalar instanceof String) return (String) scalar;
    if (scalar instanceof Number) return Expressions.number(scalar).toPlainString();
    if (scalar instanceof Boolean bool) return bool.toString();
    throw ArcException.invalid("Expected a scalar value");
  }

  /**
   * Text for matching a value as a key. Numbers that compare equal produce the same text: {@code
   * 1E+3}, {@code 1000} and {@code 1000.0} all become {@code "1000"}, and every zero becomes {@code
   * "0"}. Other scalars use {@link #text(Object)}.
   */
  public static String key(Object scalar) {
    if (!(scalar instanceof Number)) return text(scalar);
    BigDecimal number = Expressions.number(scalar);
    if (number.signum() == 0) return "0";
    return number.stripTrailingZeros().toPlainString();
  }
}
