package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Retains a whole-step prefix within an exact serialized JSON byte budget. Each retained step is
 * serialized once, to count its bytes and to write the response ({@link RetainedTrace}). A step
 * stops being serialized as soon as it passes the budget that remains, so an oversized value costs
 * the budget, not its own size: a step up to 120 MB of JSON was built whole and then discarded.
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
    var encoded = new BoundedBytes(maximumBytes - bytes - separator);
    try {
      json.writeValue(encoded, step);
    } catch (IOException error) {
      if (!encoded.exceeded)
        throw new IllegalStateException("Could not serialize an execution trace step", error);
    }
    if (encoded.exceeded) {
      truncated = true;
      return;
    }
    if (separator == 1) serialized.write(',');
    encoded.copyTo(serialized);
    steps.add(step);
    bytes += encoded.size() + separator;
  }

  /** One step's JSON, refused as soon as it passes the bytes that remain in the budget. */
  private static final class BoundedBytes extends OutputStream {
    private final int limit;
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private boolean exceeded;

    BoundedBytes(int limit) {
      this.limit = limit;
    }

    @Override
    public void write(int b) throws IOException {
      write(new byte[] {(byte) b}, 0, 1);
    }

    @Override
    public void write(byte[] b, int offset, int length) throws IOException {
      if (exceeded || (long) bytes.size() + length > limit) {
        exceeded = true;
        throw new IOException("The trace step exceeds the remaining budget");
      }
      bytes.write(b, offset, length);
    }

    int size() {
      return bytes.size();
    }

    void copyTo(ByteArrayOutputStream target) {
      target.writeBytes(bytes.toByteArray());
    }
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
