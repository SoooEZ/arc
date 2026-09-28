package dev.arc.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

/**
 * Unmodifiable copies for detached records. Detached copies are made before validation, so null
 * collections and null elements are kept for validation to report.
 */
final class Frozen {
  private Frozen() {}

  static <T> List<T> list(List<T> values) {
    return values == null ? null : Collections.unmodifiableList(new ArrayList<>(values));
  }

  /** Copies each element that is not null with {@code copy}. */
  static <T> List<T> list(List<T> values, UnaryOperator<T> copy) {
    if (values == null) return null;
    var copies = new ArrayList<T>(values.size());
    for (T value : values) copies.add(value == null ? null : copy.apply(value));
    return Collections.unmodifiableList(copies);
  }

  static <K, V> Map<K, V> map(Map<K, V> values) {
    return values == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(values));
  }

  /** A map of JSON values, each copied with {@link #value}. */
  static Map<String, Object> values(Map<String, Object> values) {
    if (values == null) return null;
    var copy = new LinkedHashMap<String, Object>();
    values.forEach((name, value) -> copy.put(name, value(value)));
    return Collections.unmodifiableMap(copy);
  }

  /**
   * A JSON value whose objects and arrays are unmodifiable copies at every level. The values come
   * from parsed JSON documents, whose parser bounds their nesting, so the recursion is bounded too.
   */
  static Object value(Object value) {
    if (value instanceof Map<?, ?> map) {
      var copy = new LinkedHashMap<Object, Object>();
      map.forEach((key, item) -> copy.put(key, value(item)));
      return Collections.unmodifiableMap(copy);
    }
    if (value instanceof List<?> items) {
      var copy = new ArrayList<Object>(items.size());
      for (Object item : items) copy.add(value(item));
      return Collections.unmodifiableList(copy);
    }
    return value;
  }
}
