package dev.arc.engine;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;

/**
 * The value bounds every number, text and collection must satisfy, wherever it enters: inputs,
 * defaults, literals, operator results, source values and responses. A root contract beside {@link
 * Limits}, so canonical text ({@link ValueText}) and typed inputs ({@link InputTypes}) can bound
 * values without depending on the expression package; {@code Expressions.number} and {@code
 * Expressions.bounded} are the expression-facing entry points.
 */
public final class ValueBounds {
  private ValueBounds() {}

  /** The bounded decimal value of a number; any other value is a recoverable type error. */
  public static BigDecimal number(Object value) {
    if (!(value instanceof Number n))
      throw ArcException.invalid("Expected a number, got " + typeOf(value));
    return (BigDecimal) bounded(decimal(n));
  }

  /** The value itself once every number, string, array and object in it is within bounds. */
  public static Object bounded(Object value) {
    bound(value, 0, new int[] {0});
    return value;
  }

  /**
   * A number that an operator or a function computed. BigDecimal never rounds a zero, so a zero
   * result keeps the combined scale of its operands: {@code amount * (rate / 365) * (1/3) * (1/7)}
   * is 0E-102 when amount is 0, while every other amount gives an ordinary 34-digit result. Such a
   * zero keeps the most decimal places a number may have ({@link Limits#MAX_NUMBER_SCALE}) instead
   * of failing only for a zero input. A zero written with a larger scale is still refused, because
   * its scale is what the writer chose.
   */
  public static BigDecimal computed(BigDecimal number) {
    if (number.signum() != 0 || Math.abs((long) number.scale()) <= Limits.MAX_NUMBER_SCALE)
      return number;
    return BigDecimal.ZERO.setScale(Integer.signum(number.scale()) * Limits.MAX_NUMBER_SCALE);
  }

  /**
   * The ARC type of a value, in the words of {@link InputTypes#NAMES} (lower case): a message named
   * JDK classes before, such as UnmodifiableMap, LinkedHashMap or ListN, depending on where the
   * same value came from.
   */
  public static String typeOf(Object value) {
    if (value == null) return "null";
    if (value instanceof Number) return "number";
    if (value instanceof String) return "string";
    if (value instanceof Boolean) return "boolean";
    if (value instanceof List<?>) return "array";
    if (value instanceof Map<?, ?>) return "object";
    return value.getClass().getSimpleName();
  }

  /** The decimal value of any number ARC meets: JSON integers, POI doubles and decimals. */
  private static BigDecimal decimal(Number value) {
    if (value instanceof BigDecimal decimal) return decimal;
    if (value instanceof BigInteger integer) return new BigDecimal(integer);
    if (value instanceof Double || value instanceof Float) {
      double d = value.doubleValue();
      if (!Double.isFinite(d)) throw ArcException.invalid("Number must be finite");
      return BigDecimal.valueOf(d);
    }
    return BigDecimal.valueOf(value.longValue());
  }

  private static void bound(Object value, int depth, int[] count) {
    if (depth > Limits.MAX_VALUE_DEPTH || ++count[0] > Limits.MAX_VALUE_ELEMENTS)
      throw ArcException.invalid("Value exceeds collection depth or size limit");
    if (value instanceof Number n && exceedsDecimalLimits(decimal(n)))
      throw ArcException.invalid("Number exceeds supported precision or magnitude");
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

  /**
   * The limits apply to the number, not to how it is written: its one spelling without trailing
   * zeros must have at most {@link Limits#MAX_NUMBER_PRECISION} digits and a scale within ±{@link
   * Limits#MAX_NUMBER_SCALE}. PostgreSQL JSONB stores 1E+100 as a 101-digit integer, which is the
   * same accepted number, and 10E+100 is 1E+101, out of range however it is spelled: checking the
   * written spelling too accepted it, and the default failed its next save once stored. Accepted
   * decimals stay below 1E+200 and so are finite as doubles; that conversion is slow for 34-digit
   * quotients, and every operand passes through here. A zero has no digits to strip, so its scale
   * counts as written: 0E-2000000000 would otherwise pass and print as two billion characters.
   */
  private static boolean exceedsDecimalLimits(BigDecimal number) {
    if (number.signum() == 0) return Math.abs((long) number.scale()) > Limits.MAX_NUMBER_SCALE;
    // Stripping zeros only lowers the scale, so this is out of range either way; stripping the
    // zeros of 100E+2147483647 would overflow its scale instead (an ArithmeticException, a 500).
    if (number.scale() < -Limits.MAX_NUMBER_SCALE) return true;
    BigDecimal stripped = number.stripTrailingZeros();
    return stripped.precision() > Limits.MAX_NUMBER_PRECISION
        || Math.abs((long) stripped.scale()) > Limits.MAX_NUMBER_SCALE;
  }
}
