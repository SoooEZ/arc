package dev.arc.engine;

import dev.arc.model.Definition.SourceBinding;
import java.util.Map;

/** The execution engine only needs a resolved source value, never storage or transport APIs. */
@FunctionalInterface
public interface SourceReader {
  Object read(SourceBinding binding, Map<String, Object> inputs);

  static SourceReader unavailable() {
    return (binding, inputs) -> {
      throw dev.arc.error.ArcException.invalid("Data sources unavailable");
    };
  }
}
