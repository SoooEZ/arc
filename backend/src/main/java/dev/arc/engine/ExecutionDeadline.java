package dev.arc.engine;

import dev.arc.error.ArcException;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/** One monotonic deadline shared by preparation, nested rules, and provider calls. */
public final class ExecutionDeadline {
  public static final long DEFAULT_TIMEOUT_MS = 30_000;
  public static final long MIN_TIMEOUT_MS = 100;
  public static final long MAX_TIMEOUT_MS = 30_000;
  private static final String TIMEOUT_RANGE =
      "Execution timeout must be "
          + Limits.format(MIN_TIMEOUT_MS)
          + "–"
          + Limits.format(MAX_TIMEOUT_MS)
          + " ms";

  private final long expiresAtNanos;

  private ExecutionDeadline(long timeoutMs) {
    expiresAtNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
  }

  public static ExecutionDeadline start(long timeoutMs) {
    if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS)
      throw ArcException.invalid(TIMEOUT_RANGE);
    return new ExecutionDeadline(timeoutMs);
  }

  public void check() {
    remainingNanos();
  }

  /**
   * Runs a read or an evaluation inside the deadline: no work starts after expiry, and a value or
   * an ARC error that arrives after it is discarded with the deadline error, whichever reader,
   * resolver or expression produced it, so a late failure is a 504 wherever it occurs. Work already
   * in flight, such as a JDBC query, is not interrupted. An error the work throws in time
   * propagates unchanged.
   */
  public <T> T within(Supplier<T> work) {
    check();
    T value;
    try {
      value = work.get();
    } catch (ArcException failure) {
      check();
      throw failure;
    }
    check();
    return value;
  }

  /** Round up so a transport timer never cancels before this deadline has expired. */
  public long remainingMillis() {
    return (remainingNanos() + 999_999) / 1_000_000;
  }

  private long remainingNanos() {
    long remaining = expiresAtNanos - System.nanoTime();
    if (remaining <= 0) throw ArcException.deadline("Rule execution deadline exceeded");
    return remaining;
  }
}
