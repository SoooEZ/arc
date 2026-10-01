package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

class ExecutionDeadlineTest {
  /**
   * The one owner of "check, work, check": no work after expiry, a late value or error discarded,
   * and the work's own errors in time untouched. Definition reads, source reads and evaluations all
   * go through it.
   */
  @Test
  void withinStartsNoWorkAfterExpiryAndDiscardsAValueThatArrivesLate() throws Exception {
    var expired = ExecutionDeadline.start(100);
    Thread.sleep(150);
    var started = new AtomicBoolean();
    assertThatThrownBy(
            () ->
                expired.within(
                    () -> {
                      started.set(true);
                      return 1;
                    }))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(504);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE);
            });
    assertThat(started).isFalse();

    var deadline = ExecutionDeadline.start(100);
    assertThatThrownBy(
            () ->
                deadline.within(
                    () -> {
                      sleep(150);
                      return "late";
                    }))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE);
              assertThat(error.getMessage()).isEqualTo("Rule execution deadline exceeded");
            });

    var late = ExecutionDeadline.start(100);
    assertThatThrownBy(
            () ->
                late.within(
                    () -> {
                      sleep(150);
                      throw ArcException.invalid("late value error");
                    }))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE))
        .hasMessage("Rule execution deadline exceeded");

    var failure = ArcException.invalid("bad");
    assertThatThrownBy(
            () ->
                ExecutionDeadline.start(30_000)
                    .within(
                        () -> {
                          throw failure;
                        }))
        .isSameAs(failure);
    assertThat(ExecutionDeadline.start(30_000).within(() -> "value")).isEqualTo("value");
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(interrupted);
    }
  }

  @Test
  void acceptsBothBoundsAndRejectsValuesOutsideThem() {
    assertThat(ExecutionDeadline.start(100).remainingMillis()).isBetween(1L, 100L);
    assertThat(ExecutionDeadline.start(30_000).remainingMillis()).isBetween(1L, 30_000L);
    for (long timeout : new long[] {Long.MIN_VALUE, 0, 99, 30_001, Long.MAX_VALUE})
      assertThatThrownBy(() -> ExecutionDeadline.start(timeout))
          .isInstanceOf(ArcException.class)
          .hasMessage("Execution timeout must be 100–30,000 ms");
  }

  @Test
  void expirationIsAGatewayTimeoutAndCannotBeRestartedByReadingTheBudget() throws Exception {
    var deadline = ExecutionDeadline.start(100);
    Thread.sleep(150);
    assertThatThrownBy(deadline::check)
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(504);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE);
            });
    assertThatThrownBy(deadline::remainingMillis).hasMessage("Rule execution deadline exceeded");
  }
}
