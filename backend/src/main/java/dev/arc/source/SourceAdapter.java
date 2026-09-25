package dev.arc.source;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.model.SourceDefinition;
import java.util.Map;

/** Add a Spring component implementing this port to support another source kind. */
public interface SourceAdapter {
  String kind();

  void validate(SourceDefinition definition);

  Object fetch(String sourceId, SourceDefinition definition, Map<String, Object> inputs);

  /** Blocking providers override this method to cancel IO when the shared deadline expires. */
  default Object fetch(
      String sourceId,
      SourceDefinition definition,
      Map<String, Object> inputs,
      ExecutionDeadline deadline) {
    deadline.check();
    Object value = fetch(sourceId, definition, inputs);
    deadline.check();
    return value;
  }
}
