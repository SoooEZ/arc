package dev.arc.engine.execution;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Retains a whole-step prefix within an exact serialized JSON byte budget. Each retained step is
 * serialized once, to count its bytes and to write the response ({@link RetainedTrace}).
 */
final class ExecutionTrace {
  private final ObjectMapper json;
  private final boolean enabled;
  private final int maximumBytes;
  private final List<Engine.Step> steps = new ArrayList<>();

  /** The steps' JSON, comma-separated, without the array's brackets. */
  private final ByteArrayOutputStream serialized = new ByteArrayOutputStream();

  private int bytes = 2; // The trace array's brackets, including an empty trace.
  private boolean truncated;

  ExecutionTrace(ObjectMapper json, boolean enabled, int maximumBytes) {
    this.json = json;
    this.enabled = enabled;
    this.maximumBytes = maximumBytes;
  }

  void add(Engine.Step step) {
    if (!enabled || truncated) return;
    int separator = steps.isEmpty() ? 0 : 1;
    byte[] encoded;
    try {
      encoded = json.writeValueAsBytes(step);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("Could not serialize an execution trace step", error);
    }
    if (encoded.length > maximumBytes - bytes - separator) {
      truncated = true;
      return;
    }
    if (separator == 1) serialized.write(',');
    serialized.write(encoded, 0, encoded.length);
    steps.add(step);
    bytes += encoded.length + separator;
  }

  /** The retained steps with the JSON array they were counted as. */
  List<Engine.Step> steps() {
    byte[] body = serialized.toByteArray();
    byte[] array = new byte[body.length + 2];
    array[0] = '[';
    System.arraycopy(body, 0, array, 1, body.length);
    array[array.length - 1] = ']';
    return new RetainedTrace(List.copyOf(steps), array);
  }

  boolean enabled() {
    return enabled;
  }

  boolean truncated() {
    return truncated;
  }

  int bytes() {
    return bytes;
  }
}
