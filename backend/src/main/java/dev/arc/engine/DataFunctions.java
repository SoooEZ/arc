package dev.arc.engine;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Explicit data conversions and object construction; never mutates an upstream value. */
final class DataFunctions {
  static Map<String, Object> object(List<Object> args) {
    var result = new LinkedHashMap<String, Object>();
    for (int i = 0; i < args.size(); i += 2) {
      if (!(args.get(i) instanceof String key) || key.isBlank() || key.length() > 160)
        throw ArcException.invalid("OBJECT keys must be text of 1 to 160 characters");
      if (result.containsKey(key)) throw ArcException.invalid("Duplicate OBJECT key: " + key);
      result.put(key, args.get(i + 1));
    }
    return result;
  }

  static Map<String, Object> merge(List<Object> args) {
    var result = new LinkedHashMap<String, Object>();
    for (Object value : args) {
      if (!(value instanceof Map<?, ?> map)) throw ArcException.invalid("MERGE expects objects");
      for (var entry : map.entrySet()) {
        if (!(entry.getKey() instanceof String key))
          throw ArcException.invalid("Object keys must be text");
        result.put(key, entry.getValue());
      }
    }
    return result;
  }

  static Object number(Object value) {
    if (value == null) return null;
    if (value instanceof Number) return Expressions.number(value);
    if (value instanceof String text) {
      try {
        return Expressions.number(new BigDecimal(text.trim()));
      } catch (NumberFormatException e) {
        throw ArcException.invalid("TO_NUMBER expects numeric text");
      }
    }
    throw ArcException.invalid("TO_NUMBER expects a number or numeric text");
  }

  static Object text(Object value) {
    if (value == null || value instanceof String) return value;
    if (value instanceof Number) return Expressions.number(value).toPlainString();
    if (value instanceof Boolean) return value.toString();
    throw ArcException.invalid("TO_STRING expects a scalar value");
  }

  static Object bool(Object value) {
    if (value == null || value instanceof Boolean) return value;
    if (value instanceof String text) {
      if (text.trim().equalsIgnoreCase("true")) return true;
      if (text.trim().equalsIgnoreCase("false")) return false;
    }
    throw ArcException.invalid("TO_BOOLEAN expects a boolean or text true/false");
  }

  private DataFunctions() {}
}
