package dev.arc.engine;

import dev.arc.error.ArcException;
import java.util.concurrent.TimeUnit;

/** One monotonic deadline shared by preparation, nested rules, and provider calls. */
public final class ExecutionDeadline {
  public static final long DEFAULT_TIMEOUT_MS = 30_000;
  public static final long MIN_TIMEOUT_MS = 100;
  public static final long MAX_TIMEOUT_MS = 30_000;

  private final long expiresAtNanos;

  private ExecutionDeadline(long timeoutMs) {
    expiresAtNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
  }

  public static ExecutionDeadline start(long timeoutMs) {
    if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS)
      throw ArcException.invalid("Execution timeout must be 100–30,000 ms");
    return new ExecutionDeadline(timeoutMs);
  }

  public void check() {
    remainingNanos();
  }

  /** Round up so a transport timer never cancels before this deadline has expired. */
  public long remainingMillis() {
    return (remainingNanos() + 999_999) / 1_000_000;
  }

  private long remainingNanos() {
    long remaining = expiresAtNanos - System.nanoTime();
    if (remaining <= 0) throw new ArcException(504, "Rule execution deadline exceeded");
    return remaining;
  }
}
