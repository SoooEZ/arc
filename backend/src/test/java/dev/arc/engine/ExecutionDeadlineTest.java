package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import org.junit.jupiter.api.Test;

class ExecutionDeadlineTest {
  @Test
  void acceptsBothBoundsAndRejectsValuesOutsideThem() {
    assertThat(ExecutionDeadline.start(100).remainingMillis()).isBetween(1L, 100L);
    assertThat(ExecutionDeadline.start(30_000).remainingMillis()).isBetween(1L, 30_000L);
    for (long timeout : new long[] {Long.MIN_VALUE, 0, 99, 30_001, Long.MAX_VALUE})
      assertThatThrownBy(() -> ExecutionDeadline.start(timeout))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("100–30,000");
  }

  @Test
  void expirationIsAGatewayTimeoutAndCannotBeRestartedByReadingTheBudget() throws Exception {
    var deadline = ExecutionDeadline.start(100);
    Thread.sleep(150);
    assertThatThrownBy(deadline::check)
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
    assertThatThrownBy(deadline::remainingMillis).hasMessage("Rule execution deadline exceeded");
  }
}
