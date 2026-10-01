package dev.arc.rule;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * Threads deep enough for any evaluation the limits allow. The deepest, 17 nested rules each inside
 * expressions nested 48 levels deep, needs about 1.5 MiB of stack before the JIT compiles the
 * evaluator, and request threads have 1 MiB on Linux x64: the first such request after a start
 * failed with a 500. Idle threads are reused and end after a minute.
 */
final class EvaluationThreads {
  /** About 2.7 times what the deepest evaluation needs on a cold JVM. */
  private static final long STACK_BYTES = 4L * 1024 * 1024;

  private static final AtomicInteger NUMBER = new AtomicInteger();

  private static final ExecutorService THREADS =
      Executors.newCachedThreadPool(
          work -> {
            var thread =
                new Thread(null, work, "arc-evaluation-" + NUMBER.incrementAndGet(), STACK_BYTES);
            thread.setDaemon(true);
            return thread;
          });

  private EvaluationThreads() {}

  /** Runs an evaluation on a deep thread and returns or throws what it does. */
  static <T> T run(Supplier<T> evaluation) {
    Future<T> result = THREADS.submit(evaluation::get);
    try {
      return result.get();
    } catch (ExecutionException failure) {
      if (failure.getCause() instanceof RuntimeException runtime) throw runtime;
      if (failure.getCause() instanceof Error error) throw error;
      throw new IllegalStateException(failure.getCause());
    } catch (InterruptedException interrupted) {
      result.cancel(true);
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while a rule was evaluated", interrupted);
    }
  }
}
