package dev.arc;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.expression.Expressions;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;

/** The API process reads date text the same way on every host. */
class HostSettingsTest {
  @Test
  void dateTextIsReadInUtcWhateverTheHostTimeZone() {
    TimeZone zone = TimeZone.getDefault();
    Locale locale = Locale.getDefault();
    try {
      // POI converts date text through the JVM's default zone: on an Asia/Shanghai host,
      // midnight local time is the previous day in UTC, so $DAY("1/15/2020") was 14.
      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
      Locale.setDefault(Locale.GERMANY);
      ArcApplication.pinHostSettings();
      assertThat(Expressions.evaluate("$DAY(\"1/15/2020\")", Map.of()))
          .isEqualTo(new BigDecimal("15"));
      assertThat(Expressions.evaluate("$VALUE(\"1/15/2020\")", Map.of()))
          .isEqualTo(new BigDecimal("43845"));
      assertThat(Expressions.evaluate("$HOUR(\"12 Mar 2026\")", Map.of()))
          .isEqualTo(BigDecimal.ZERO);
      assertThat(Expressions.evaluate("$TIMEVALUE(\"10:30\")", Map.of()))
          .isEqualTo(new BigDecimal("0.4375"));
      assertThat(Expressions.evaluate("$TEXT(\"12 Mar 2026\", \"yyyy-mm-dd hh:mm\")", Map.of()))
          .isEqualTo("2026-03-12 00:00");
      assertThat(TimeZone.getDefault().getID()).isEqualTo("UTC");
      assertThat(Locale.getDefault()).isEqualTo(Locale.US);
    } finally {
      TimeZone.setDefault(zone);
      Locale.setDefault(locale);
    }
  }
}
