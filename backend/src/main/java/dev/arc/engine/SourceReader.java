package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.SourceBinding;
import java.util.Map;

/** The execution engine only needs a resolved source value, never storage or transport APIs. */
@FunctionalInterface
public interface SourceReader {
  /**
   * Reads the current value of a binding for already evaluated arguments. The deadline belongs to
   * the whole execution, and the caller checks it before and after this call; a reader that blocks
   * on IO must also stop when it expires, as HTTP sources do by cancelling their request.
   */
  Object read(SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline);

  static SourceReader unavailable() {
    return (binding, inputs, deadline) -> {
      throw ArcException.invalid("Data sources unavailable");
    };
  }
}
