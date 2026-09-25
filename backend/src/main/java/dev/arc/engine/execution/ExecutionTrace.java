package dev.arc.engine.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/** Retains a whole-step prefix within an exact serialized JSON byte budget. */
final class ExecutionTrace {
  private final ObjectMapper json;
  private final boolean enabled;
  private final int maximumBytes;
  private final List<Engine.Step> steps = new ArrayList<>();
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
    var counter = new ByteCounter(maximumBytes - bytes - separator);
    try {
      json.writeValue(counter, step);
    } catch (IOException error) {
      if (!counter.exceeded)
        throw new IllegalStateException("Could not measure execution trace", error);
    }
    if (counter.exceeded) {
      truncated = true;
      return;
    }
    steps.add(step);
    bytes += counter.count + separator;
  }

  List<Engine.Step> steps() {
    return List.copyOf(steps);
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

  private static final class ByteCounter extends OutputStream {
    private final int maximum;
    private int count;
    private boolean exceeded;

    ByteCounter(int maximum) {
      this.maximum = maximum;
    }

    @Override
    public void write(int value) throws IOException {
      add(1);
    }

    @Override
    public void write(byte[] value, int offset, int length) throws IOException {
      add(length);
    }

    private void add(int length) throws IOException {
      if (length > maximum - count) {
        exceeded = true;
        throw new IOException("Trace byte limit reached");
      }
      count += length;
    }
  }
}
