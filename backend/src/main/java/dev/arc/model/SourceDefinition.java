package dev.arc.model;

import dev.arc.model.Definition.Input;
import java.util.List;
import java.util.Map;

/**
 * A source configuration. {@code timeoutMs} is boxed so that an HTTP definition without one is
 * refused by its adapter instead of being read as 0 (lesson B29); a LOOKUP definition does not use
 * it, and stored lookup versions may hold 0 or nothing there.
 */
public record SourceDefinition(
    String kind,
    String url,
    List<Input> parameters,
    Map<String, Object> entries,
    Map<String, String> secretHeaders,
    Integer timeoutMs) {
  /**
   * An optional configuration field beyond the kind, its parameters and the timeout. Each kind's
   * adapter declares which of them it reads; validation rejects any other that is set.
   */
  public enum Field {
    /** {@code url} */
    URL,
    /** {@code entries}, a lookup table. */
    ENTRIES,
    /** {@code secretHeaders} */
    SECRET_HEADERS
  }

  /** Whether the definition sets the field: a null, blank or empty value is unset. */
  public boolean sets(Field field) {
    return switch (field) {
      case URL -> url != null && !url.isBlank();
      case ENTRIES -> entries != null && !entries.isEmpty();
      case SECRET_HEADERS -> secretHeaders != null && !secretHeaders.isEmpty();
    };
  }

  /**
   * A copy that shares no list or map with this definition; lookup entries and parameter defaults
   * are frozen at every level. Stored versions are copied as they are, including null values that
   * current validation rejects, so an older version still reads as it did when it was tested.
   */
  public SourceDefinition detached() {
    return new SourceDefinition(
        kind,
        url,
        Frozen.list(parameters, Input::detached),
        Frozen.values(entries),
        Frozen.map(secretHeaders),
        timeoutMs);
  }
}
