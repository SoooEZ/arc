package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.util.*;
import org.apache.poi.ss.format.CellFormat;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.formula.functions.TextFunction;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.util.LocaleUtil;
import org.junit.jupiter.api.Test;

/** Excel text and dates are the same on every host and leave no formatter state behind. */
class ExcelTextTest {
  private static Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  @Test
  void resultsDoNotDependOnTheHostLocaleOrTimeZone() {
    Locale locale = Locale.getDefault();
    TimeZone zone = TimeZone.getDefault();
    try {
      // Turkish lower-cases "I" to a dotless ı; São Paulo started daylight saving at midnight.
      for (Locale host :
          List.of(Locale.GERMANY, Locale.SIMPLIFIED_CHINESE, Locale.of("tr", "TR"))) {
        Locale.setDefault(host);
        TimeZone.setDefault(TimeZone.getTimeZone("America/Sao_Paulo"));
        assertThat(eval("$TEXT(1234.5, \"#,##0.00\")")).as(host.toString()).isEqualTo("1,234.50");
        assertThat(eval("$TEXT(0.256, \"0.0%\")")).as(host.toString()).isEqualTo("25.6%");
        assertThat(eval("$DOLLAR(1234.5, 1)")).as(host.toString()).isEqualTo("$1,234.5");
        assertThat(eval("$FIXED(1234.5, 1)")).as(host.toString()).isEqualTo("1,234.5");
        assertThat(eval("$TEXT(46281, \"mmmm d, yyyy\")"))
            .as(host.toString())
            .isEqualTo("September 16, 2026");
        assertThat(eval("$TEXT(1234.5, \"0.00\") == \"1234.50\"")).isEqualTo(true);
        assertThat(eval("$DATE(2018, 11, 4)"))
            .as(host.toString())
            .isEqualTo(new BigDecimal("43408"));
        assertThat(eval("$HOUR($DATE(2018, 11, 4))"))
            .as(host.toString())
            .isEqualTo(BigDecimal.ZERO);
        assertThat(eval("$DCOUNTA([[\"name\"], [\"IRMA\"]], \"name\", [[\"name\"], [\"i*\"]])"))
            .as(host.toString())
            .isEqualTo(BigDecimal.ONE);
        assertThat(eval("$UPPER(\"istanbul\")")).as(host.toString()).isEqualTo("ISTANBUL");
      }
    } finally {
      Locale.setDefault(locale);
      TimeZone.setDefault(zone);
    }
    // POI's locale and time zone are pinned only for the call, never left on the thread.
    assertThat(LocaleUtil.getUserLocale()).isEqualTo(Locale.getDefault());
    assertThat(LocaleUtil.getUserTimeZone()).isEqualTo(TimeZone.getDefault());
  }

  @Test
  void formatCodesBuiltFromDataDoNotGrowProcessWideCaches() throws ReflectiveOperationException {
    int formatterEntries = poiTextFormatterCache().size();
    int sectionEntries = cellFormatCacheSize();
    for (int i = 0; i < 3_000; i++) {
      Expressions.evaluate(
          "$TEXT(i, $CONCAT(\"0.\", $REPT(\"0\", i % 40), \"#\", i))", Map.of("i", i));
      Expressions.evaluate("$TEXT(-i, $CONCAT(\"0;(0);\\\"zero \", i, \"\\\"\"))", Map.of("i", i));
      Expressions.evaluate("$TEXT(i, $CONCAT(\"[>=\", i, \"]0;0.0\"))", Map.of("i", i));
    }
    assertThat(poiTextFormatterCache().size()).isEqualTo(formatterEntries);
    assertThat(cellFormatCacheSize()).isEqualTo(sectionEntries);
  }

  @Test
  void textNoLongerDependsOnWhichFormatsEarlierCallsUsed() {
    // POI's shared formatter reused the date format cached by an earlier valid date for a negative
    // number, so the same call returned "1969-12-31" or "-5.0" depending on history.
    assertThat(eval("$TEXT(-5, \"yyyy-mm-dd\")")).isEqualTo("-5.0");
    assertThat(eval("$TEXT(46281, \"yyyy-mm-dd\")")).isEqualTo("2026-09-16");
    assertThat(eval("$TEXT(-5, \"yyyy-mm-dd\")")).isEqualTo("-5.0");
  }

  @Test
  void textMatchesPoiForSingleAndMultiSectionCodes() {
    var codes =
        List.of(
            "0",
            "0.00",
            "#,##0.00",
            "0.0%",
            "0.00E+00",
            "General",
            "@",
            "$#,##0.00;($#,##0.00)",
            "0;-0;\"zero\"",
            "+0.0%;-0.0%;0.0%",
            "0.00;[Red]-0.00;0;\"text\"",
            "[>=100]0;0.0",
            "[<0]\"neg\";[>0]\"pos\"",
            "[>1000]#,##0,\"K\";0",
            "yyyy-mm-dd",
            "mmmm d, yyyy",
            "#,##0;(#,##0);\"-\";@",
            "h:mm AM/PM",
            "# ?/?",
            "0;0;0;0;0");
    var values = List.of(0.0, 5.0, -5.0, 1234.5678, -1234.5678, 0.25, 46281.75, 1.0e7, -0.0001);
    for (String code : codes) {
      for (double value : values) {
        assertThat(arcText(value, code))
            .as(code + " with " + value)
            .isEqualTo(poiText(value, code));
      }
    }
    assertThat(eval("$TEXT(\"12.5\", \"0.00\")")).isEqualTo("12.50");
    assertThat(eval("$TEXT(\"not a number\", \"0.00\")")).isEqualTo("not a number");
    assertThat(eval("$TEXT(true, \"0\")")).isEqualTo("TRUE");
    assertThat(eval("$TEXT(null, \"0.0\")")).isEqualTo("0.0");
    assertThat(eval("$TEXT(5, 0)")).isEqualTo("5");
    assertThatThrownBy(() -> eval("$TEXT(5, true)")).hasMessage("TEXT: #VALUE!");
  }

  @Test
  void sectionedCodesWriteOneExponentSignAndKeepTheirText() {
    // DataFormatter's "E" to "E+" repair for DecimalFormat output also ran on CellFormat's, which
    // already has the sign, and on any upper-case E in literal text. POI itself answers the same,
    // so the comparison with POI above cannot see it; these are Excel's results.
    String scientific = "0.00E+00;-0.00E+00;0";
    assertThat(eval("$TEXT(1.5, \"" + scientific + "\")")).isEqualTo("1.50E+00");
    assertThat(eval("$TEXT(-1.5, \"" + scientific + "\")")).isEqualTo("-1.50E+00");
    assertThat(eval("$TEXT(12345, \"[>=100]0.00E+00;0\")")).isEqualTo("1.23E+04");
    assertThat(eval("$TEXT(0, \"General;General;\\\"ZERO\\\"\")")).isEqualTo("ZERO");
    String thousands = "[>=1000000]0.0,,\\\" MEUR\\\";[>=1000]0.0,\\\" KEUR\\\";General";
    assertThat(eval("$TEXT(2500, \"" + thousands + "\")")).isEqualTo("2.5 KEUR");
    assertThat(eval("$TEXT(5, \"" + thousands + "\")")).isEqualTo("5");
    // POI gives the doubled sign for the same code, which is why the repair is left out.
    assertThat(poiText(1.5, scientific)).isEqualTo("1.50E++00");
  }

  @Test
  void multiSectionCodesThatPoiCannotApplyAreValueErrors() {
    // POI logged a warning with a stack trace for each call and fell back to reading the whole
    // code as one section; ARC reports #VALUE! instead of guessing.
    assertThat(eval("$TEXT(5, \"d-mmm;@;0\")"))
        .isEqualTo(poiText(5, "d-mmm;@;0"))
        .isEqualTo("5-Jan");
    assertThatThrownBy(() -> eval("$TEXT(-5, \"d-mmm;@;0\")")).hasMessage("TEXT: #VALUE!");
    assertThat(eval("$ISERROR($TEXT(-5, \"d-mmm;@;0\"))")).isEqualTo(true);
  }

  private static String arcText(double value, String code) {
    try {
      var scope = Map.<String, Object>of("value", BigDecimal.valueOf(value), "code", code);
      return String.valueOf(Expressions.evaluate("$TEXT(value, code)", scope));
    } catch (ArcException error) {
      return "error";
    }
  }

  /**
   * POI's formatting with ARC's pinned locale and time zone. A fresh formatter per call, because
   * the one inside POI's TEXT answers from whatever earlier calls cached; multi-section codes still
   * go through POI's CellFormat here.
   */
  private static String poiText(double value, String code) {
    LocaleUtil.setUserLocale(Locale.US);
    LocaleUtil.setUserTimeZone(LocaleUtil.TIMEZONE_UTC);
    try {
      return new DataFormatter(Locale.US).formatRawCellContents(value, -1, code);
    } catch (RuntimeException error) {
      return "error";
    } finally {
      LocaleUtil.resetUserLocale();
      LocaleUtil.resetUserTimeZone();
    }
  }

  private static Map<?, ?> poiTextFormatterCache() throws ReflectiveOperationException {
    Field formatter = TextFunction.class.getDeclaredField("formatter");
    formatter.setAccessible(true);
    Field formats = DataFormatter.class.getDeclaredField("formats");
    formats.setAccessible(true);
    return (Map<?, ?>) formats.get(formatter.get(null));
  }

  private static int cellFormatCacheSize() throws ReflectiveOperationException {
    Field cache = CellFormat.class.getDeclaredField("formatCache");
    cache.setAccessible(true);
    int entries = 0;
    for (Object perLocale : ((Map<?, ?>) cache.get(null)).values())
      entries += ((Map<?, ?>) perLocale).size();
    return entries;
  }
}
