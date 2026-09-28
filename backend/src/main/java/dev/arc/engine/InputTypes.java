package dev.arc.engine;

import dev.arc.error.ArcException;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Strict declared value types; the caller owns required, missing and default semantics. */
public final class InputTypes {
  /** Every declared input type, in the order messages and ARC Script usage list them. */
  public static final List<String> NAMES =
      List.of("NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT");

  private InputTypes() {}

  public static Object check(String name, String type, Object value) {
    boolean valid =
        switch (type) {
          case "NUMBER" -> value instanceof Number;
          case "STRING" -> value instanceof String;
          case "BOOLEAN" -> value instanceof Boolean;
          case "ARRAY" -> value instanceof List<?>;
          case "OBJECT" -> value instanceof Map<?, ?>;
          default -> false;
        };
    // Locale.ROOT: the JVM default turns STRING into "strıng" under tr and az.
    if (!valid)
      throw ArcException.invalid("Input '" + name + "' must be " + type.toLowerCase(Locale.ROOT));
    return value instanceof Number ? ValueBounds.number(value) : ValueBounds.bounded(value);
  }
}
