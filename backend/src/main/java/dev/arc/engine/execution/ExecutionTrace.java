package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Retains a whole-step prefix within an exact serialized JSON byte budget. Each retained step is
 * serialized once, straight into the array's buffer, to count its bytes and to write the response
 * ({@link RetainedTrace}). A step stops being serialized as soon as it passes the budget that
 * remains, and its bytes are cut back, so an oversized value costs the budget, not its own size: a
 * step up to 120 MB of JSON was built whole and then discarded.
 */
final class ExecutionTrace {
  private final ObjectMapper json;
  private final boolean enabled;
  private final int maximumBytes;
  private final List<Engine.Step> steps = new ArrayList<>();

  /** The array's JSON so far: '[' and the retained steps, comma-separated, without the ']'. */
  private final TraceBytes serialized = new TraceBytes();

  private boolean truncated;

  ExecutionTrace(ObjectMapper json, boolean enabled, int maximumBytes) {
    this.json = json;
    this.enabled = enabled;
    this.maximumBytes = maximumBytes;
  }

  void add(Engine.Step step) {
    if (!enabled || truncated) return;
    int start = serialized.length();
    // The closing bracket must still fit after the step.
    serialized.allowUpTo(maximumBytes - 1);
    try {
      if (!steps.isEmpty()) serialized.write(',');
      json.writeValue(serialized, step);
    } catch (IOException error) {
      if (!serialized.exceeded())
        throw new IllegalStateException("Could not serialize an execution trace step", error);
    }
    if (serialized.exceeded()) {
      serialized.cutBackTo(start);
      truncated = true;
      return;
    }
    steps.add(step);
  }

  /**
   * One growable buffer for the whole array, so a step's bytes are moved once, from the generator's
   * buffer; a step that passes the budget is refused as soon as it does.
   */
  private static final class TraceBytes extends OutputStream {
    private byte[] buffer = new byte[1024];
    private int length;
    private int limit;
    private boolean exceeded;

    TraceBytes() {
      buffer[0] = '[';
      length = 1;
    }

    void allowUpTo(int limit) {
      this.limit = limit;
      exceeded = false;
    }

    boolean exceeded() {
      return exceeded;
    }

    int length() {
      return length;
    }

    void cutBackTo(int length) {
      this.length = length;
    }

    @Override
    public void write(int b) throws IOException {
      write(new byte[] {(byte) b}, 0, 1);
    }

    @Override
    public void write(byte[] b, int offset, int count) throws IOException {
      if (exceeded || (long) length + count > limit) {
        exceeded = true;
        throw new IOException("The trace step exceeds the remaining budget");
      }
      if (length + count > buffer.length)
        buffer = Arrays.copyOf(buffer, Math.max(buffer.length * 2, length + count));
      System.arraycopy(b, offset, buffer, length, count);
      length += count;
    }

    /** The array closed with ']', as the response writes it. */
    byte[] closed() {
      byte[] array = Arrays.copyOf(buffer, length + 1);
      array[length] = ']';
      return array;
    }
  }

  /** The retained steps with the JSON array they were counted as. */
  List<Engine.Step> steps() {
    return new RetainedTrace(List.copyOf(steps), serialized.closed());
  }

  boolean enabled() {
    return enabled;
  }

  boolean truncated() {
    return truncated;
  }

  /** The array's bytes, the brackets included: 2 for an empty trace. */
  int bytes() {
    return serialized.length() + 1;
  }
}
