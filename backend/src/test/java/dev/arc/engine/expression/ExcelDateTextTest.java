package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.usermodel.DateUtil;
import org.junit.jupiter.api.Test;

/** Date text without a year would take its year from the clock inside POI. */
class ExcelDateTextTest {
  private static Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  @Test
  void dateReadersRefuseDateTextWithoutAYear() {
    // POI completed these with the year the process loaded DateUtil (DATEVALUE: the current year),
    // a hidden TODAY() in published rules.
    for (String expression :
        List.of(
            "$YEAR(\"1 Jan\")",
            "$DAY(\"1/15\")",
            "$MONTH(\"15-Jan\")",
            "$VALUE(\"1 January\")",
            "$WEEKDAY(\"1. Jan\")",
            "$DATEVALUE(\"Jan-15\")",
            "$DATEVALUE(\"1/15\")",
            "$TEXT(\"1 Jan\", \"yyyy-mm-dd\")",
            "$HOUR(\"1 Jan 10:30\")"))
      assertThatThrownBy(() -> eval(expression))
          .as(expression)
          .isInstanceOfSatisfying(ArcException.class, e -> assertThat(e.status()).isEqualTo(422))
          .hasMessageEndingWith(": date text needs a year, such as \"15 Jan 2026\"");
    assertThat(eval("$YEAR(\"1 Jan 2020\")")).isEqualTo(new BigDecimal("2020"));
    assertThat(eval("$DAY(\"1/15/2020\")")).isEqualTo(new BigDecimal("15"));
    assertThat(eval("$DATEVALUE(\"2020-Jan-15\")")).isEqualTo(new BigDecimal("43845"));
    assertThat(eval("$TEXT(\"15 Jan 2020\", \"yyyy-mm-dd\")")).isEqualTo("2020-01-15");
    // A time has no year to miss, numbers stay numbers, and text functions keep text as text.
    assertThat(eval("$TIMEVALUE(\"10:30\")")).isEqualTo(new BigDecimal("0.4375"));
    assertThat(eval("$VALUE(\"43845\")")).isEqualTo(new BigDecimal("43845"));
    assertThat(eval("$LEN(\"1 Jan\")")).isEqualTo(new BigDecimal("5"));
    assertThat(eval("$TEXT(1, \"d mmm\")")).isEqualTo("1 Jan");
  }

  @Test
  void theCopiedPoiDatePatternsMatchPoi() throws Exception {
    var field = DateUtil.class.getDeclaredField("dateTimeFormats");
    field.setAccessible(true);
    String poi = field.get(null).toString();
    // POI's formatter adds parseDefaulting(YEAR_OF_ERA, <year>), which ARC leaves out.
    String withoutDefault =
        poi.replaceFirst(
            "java\\.time\\.format\\.DateTimeFormatterBuilder\\$DefaultValueParser@.*$", "");
    assertThat(withoutDefault).isNotEqualTo(poi);
    assertThat(ExcelDateText.POI_DATE_TIME.toString()).isEqualTo(withoutDefault);
    assertThat(((DateTimeFormatter) field.get(null)).getLocale()).isEqualTo(Locale.US);

    var formats = Class.forName("org.apache.poi.ss.util.DateParser$Format");
    var pattern = formats.getDeclaredField("pattern");
    var hasYear = formats.getDeclaredField("hasYear");
    pattern.setAccessible(true);
    hasYear.setAccessible(true);
    var poiFormats = new ArrayList<String>();
    for (Object format : formats.getEnumConstants())
      poiFormats.add(((Pattern) pattern.get(format)).pattern() + " " + hasYear.get(format));
    assertThat(
            ExcelDateText.DATE_VALUE_FORMATS.stream()
                .map(format -> format.pattern().pattern() + " " + format.hasYear())
                .toList())
        .isEqualTo(poiFormats);
  }

  @Test
  void everyDateReaderIsExecutable() {
    assertThat(FunctionCatalog.excelFunctions()).containsAll(ExcelDateText.DATE_READERS);
  }
}
