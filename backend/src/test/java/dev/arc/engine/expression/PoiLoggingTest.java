package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Configuration;

/**
 * application.yaml silences POI's per-call function logging: ARC reports every POI error value
 * itself, so RATE's ERROR with a stack trace and IRR's WARN per failed call only flooded the log,
 * even when {@code $IFERROR} handled the result.
 */
@SpringBootTest(
    classes = PoiLoggingTest.NoBeans.class,
    webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ExtendWith(OutputCaptureExtension.class)
class PoiLoggingTest {
  @Configuration
  static class NoBeans {}

  @Test
  void handledPoiErrorsWriteNothingToTheLog(CapturedOutput output) {
    assertThat(Expressions.evaluate("$IFERROR($RATE(1e9, 1e9, 1e9), 0)", Map.of()))
        .isEqualTo(BigDecimal.ZERO);
    assertThat(Expressions.evaluate("$IFERROR($IRR([1, 1, 1]), 0)", Map.of()))
        .isEqualTo(BigDecimal.ZERO);
    assertThat(Expressions.evaluate("$IFERROR($RATE(\"abc\", 1, 1), \"bad\")", Map.of()))
        .isEqualTo("bad");
    assertThat(output.getAll())
        .doesNotContain("Can't evaluate rate function")
        .doesNotContain("Returning NaN because IRR");
  }
}
