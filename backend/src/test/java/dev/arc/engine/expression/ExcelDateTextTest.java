package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.formula.function.FunctionMetadata;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;
import org.apache.poi.ss.formula.ptg.Ptg;
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
            "$HOUR(\"1 Jan 10:30\")",
            // Numeric functions read text through the same date parser.
            "$INT(\"15 Jan\")",
            "$MOD(\"15 Jan\", 7)",
            "$FIXED(\"1 Jan\")",
            "$MMULT([[\"15 Jan\"]], [[1]])"))
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
    assertThat(eval("$LEFT(\"15 Jan\", 2)")).isEqualTo("15");
    assertThat(eval("$ADDRESS(1, 1, 1, true, \"15 Jan\")")).isEqualTo("'15 Jan'!$A$1");
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

  /**
   * POI converts text to a number through DateUtil wherever it reads a number, so date text without
   * a year took the year the process started in INT, MOD, FIXED and the financial and matrix
   * functions too: $INT("15 Jan") changed at New Year. Wherever a function completes date text with
   * that year (the result for "15 Jan" is the result for "15 Jan" of the load year, and differs
   * from the next year's), ARC must refuse the text first.
   */
  @Test
  void everyArgumentThatReadsDateTextRefusesItWithoutAYear() {
    int loadYear =
        LocalDate.of(1899, 12, 30).plusDays(DateUtil.parseDateTime("15 Jan").longValue()).getYear();
    var missed = new TreeSet<String>();
    for (String name : new TreeSet<>(FunctionCatalog.excelFunctions())) {
      if (Functions.arcFunctionNames().contains(name)) continue;
      var metadata = FunctionMetadataRegistry.getFunctionByName(name);
      if (metadata == null) continue;
      int fewest = Math.max(1, metadata.getMinParams());
      for (int count = fewest; count <= Math.min(metadata.getMaxParams(), fewest + 2); count++)
        for (int position = 0; position < count; position++)
          for (var fillers : FILLERS)
            for (boolean inArray : List.of(false, true)) {
              Object yearless =
                  call(name, args(metadata, count, position, fillers, inArray, "15 Jan"));
              Object loaded =
                  call(
                      name,
                      args(metadata, count, position, fillers, inArray, "15 Jan " + loadYear));
              Object next =
                  call(
                      name,
                      args(
                          metadata, count, position, fillers, inArray, "15 Jan " + (loadYear + 1)));
              if (yearless == null || next == null || !yearless.equals(loaded)) continue;
              if (loaded.equals(next)) continue;
              try {
                ExcelDateText.refuseDatesWithoutYear(
                    name, args(metadata, count, position, fillers, inArray, "15 Jan"));
                missed.add(name + " argument " + (position + 1));
              } catch (ArcException refused) {
                // ARC refuses the text before POI reads it.
              }
            }
    }
    assertThat(missed).isEmpty();
  }

  private static final List<List<BigDecimal>> FILLERS =
      List.of(
          List.of(new BigDecimal("2")),
          List.of(
              new BigDecimal("0.05"),
              new BigDecimal("12"),
              new BigDecimal("1000"),
              BigDecimal.ZERO,
              BigDecimal.ZERO,
              BigDecimal.ONE),
          List.of(BigDecimal.ONE),
          List.of(new BigDecimal("3")));

  /** Arguments for a call: date text at one position (alone or in an array), numbers elsewhere. */
  private static List<Object> args(
      FunctionMetadata metadata,
      int count,
      int position,
      List<BigDecimal> fillers,
      boolean inArray,
      String text) {
    byte[] classes = metadata.getParameterClassCodes();
    var args = new ArrayList<Object>();
    for (int index = 0; index < count; index++) {
      if (index == position) {
        args.add(inArray ? List.of(text, BigDecimal.ONE) : text);
        continue;
      }
      Object filler = fillers.get(Math.min(index, fillers.size() - 1));
      byte parameterClass =
          classes.length == 0 ? Ptg.CLASS_VALUE : classes[Math.min(index, classes.length - 1)];
      args.add(parameterClass == Ptg.CLASS_VALUE ? filler : List.of(filler, new BigDecimal("3")));
    }
    return args;
  }

  /** POI's answer, or null when the call fails. */
  private static Object call(String name, List<Object> args) {
    try {
      return ExcelFunctionAdapter.evaluate(name, args);
    } catch (RuntimeException failed) {
      return null;
    }
  }

  @Test
  void everyDateReaderIsExecutable() {
    assertThat(FunctionCatalog.excelFunctions()).containsAll(ExcelDateText.DATE_READERS);
  }
}
