package dev.arc;

import java.util.Locale;
import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ArcApplication {
  public static void main(String[] args) {
    pinHostSettings();
    SpringApplication.run(ArcApplication.class, args);
  }

  /**
   * Results must not depend on the host. POI converts date text through the JVM's default time zone
   * ({@code DateUtil.parseDateTime}), which its per-call settings cannot reach, so
   * $DAY("1/15/2020") was 14 on an Asia/Shanghai host; and its date formatter takes the default
   * locale when it loads. The process therefore runs in UTC with the en-US locale, whatever the
   * host or launcher.
   */
  public static void pinHostSettings() {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    Locale.setDefault(Locale.US);
  }
}
