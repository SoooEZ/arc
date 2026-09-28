package dev.arc.model;

import dev.arc.model.Definition.Input;
import java.util.List;
import java.util.Map;

public record SourceDefinition(
    String kind,
    String url,
    List<Input> parameters,
    Map<String, Object> entries,
    Map<String, String> secretHeaders,
    int timeoutMs) {
  /**
   * A copy that shares no list or map with this definition; lookup entries are frozen at every
   * level. Stored versions are copied as they are, including null values that current validation
   * rejects, so an older version still reads as it did when it was tested.
   */
  public SourceDefinition detached() {
    return new SourceDefinition(
        kind,
        url,
        Frozen.list(parameters),
        Frozen.values(entries),
        Frozen.map(secretHeaders),
        timeoutMs);
  }
}
