package dev.arc.engine;

import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import java.util.List;
import java.util.Map;

/** Strict declared value types; the caller owns required, missing and default semantics. */
public final class InputTypes {
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
    if (!valid) throw ArcException.invalid("Input '" + name + "' must be " + type.toLowerCase());
    return value instanceof Number ? Expressions.number(value) : Expressions.bounded(value);
  }
}
