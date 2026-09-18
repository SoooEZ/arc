package dev.arc.source;

import dev.arc.model.SourceDefinition;
import java.util.Map;

/** Add a Spring component implementing this port to support another source kind. */
public interface SourceAdapter {
  String kind();

  void validate(SourceDefinition definition);

  Object fetch(String sourceId, SourceDefinition definition, Map<String, Object> inputs);
}
