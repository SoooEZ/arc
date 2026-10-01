package dev.arc.engine;

import dev.arc.error.ArcException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** Strict declared value types; the caller owns required, missing and default semantics. */
public final class InputTypes {
  /**
   * A declared value type; its name is the JSON {@code type}. Each fact is an exhaustive switch, so
   * a new type does not compile until it decides which values it accepts and whether it is scalar.
   */
  public enum Type {
    NUMBER,
    STRING,
    BOOLEAN,
    ARRAY,
    OBJECT;

    /** The type a JSON {@code type} names exactly; empty for null, unknown or differently cased. */
    public static Optional<Type> parse(String name) {
      for (Type type : values()) if (type.name().equals(name)) return Optional.of(type);
      return Optional.empty();
    }

    /** One value rather than a collection, as a source parameter must be. */
    public boolean scalar() {
      return switch (this) {
        case NUMBER, STRING, BOOLEAN -> true;
        case ARRAY, OBJECT -> false;
      };
    }

    private boolean accepts(Object value) {
      return switch (this) {
        case NUMBER -> value instanceof Number;
        case STRING -> value instanceof String;
        case BOOLEAN -> value instanceof Boolean;
        case ARRAY -> value instanceof List<?>;
        case OBJECT -> value instanceof Map<?, ?>;
      };
    }
  }

  /** Every declared input type, in the order messages and ARC Script usage list them. */
  public static final List<String> NAMES = Arrays.stream(Type.values()).map(Type::name).toList();

  private InputTypes() {}

  /** The value, bounded, when it has the declared type; a mismatch or an unknown type is a 422. */
  public static Object check(String name, String type, Object value) {
    boolean valid = Type.parse(type).filter(declared -> declared.accepts(value)).isPresent();
    // Locale.ROOT: the JVM default turns STRING into "strıng" under tr and az.
    if (!valid)
      throw ArcException.invalid(
          "Input '" + name + "' must be " + String.valueOf(type).toLowerCase(Locale.ROOT));
    return value instanceof Number ? ValueBounds.number(value) : ValueBounds.bounded(value);
  }
}
