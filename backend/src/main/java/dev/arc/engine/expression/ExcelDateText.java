package dev.arc.engine.expression;

import dev.arc.error.ArcException;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoField;
import java.time.temporal.TemporalAccessor;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.formula.eval.OperandResolver;

/**
 * Date text that POI would read without a year. POI fills a missing year in from the clock:
 * DateUtil, which reads date text for numeric arguments, VALUE, TIMEVALUE and TEXT, uses the year
 * in which the API process first loaded it, and DATEVALUE's parser the current year. Either is a
 * hidden TODAY(), which ARC leaves out because a published rule must not change with the date (NOW
 * and TODAY are reference-only). The functions that read dates refuse such text before POI runs:
 * {@code $YEAR("1 Jan")} is a 422 instead of the year the process started.
 */
final class ExcelDateText {
  /** The executable functions whose text arguments POI reads as dates. */
  static final Set<String> DATE_READERS =
      Set.of(
          "DAY",
          "MONTH",
          "YEAR",
          "WEEKDAY",
          "HOUR",
          "MINUTE",
          "SECOND",
          "DATE",
          "TIME",
          "DATEVALUE",
          "DAYS360",
          "TIMEVALUE",
          "VALUE",
          "TEXT");

  /**
   * The date and time patterns of POI's {@code DateUtil.parseDateTime}, without the default year
   * POI adds. POI keeps its formatter private, so this copy is pinned by a test that reads POI's
   * field.
   */
  static final List<String> POI_DATE_TIME_PATTERNS =
      List.of(
          "[d[.] [MMMM][MMM][ yyyy]][[ ]h:m[:s][.SSS] a][[ ]H:m[:s][.SSS]]",
          "[[yyyy ]d-[MMMM][MMM][-yyyy]][[ ]h:m[:s][.SSS] a][[ ]H:m[:s][.SSS]]",
          "[M/dd[/yyyy]][[ ]h:m[:s][.SSS] a][[ ]H:m[:s][.SSS]]",
          "[[yyyy/]M/dd][[ ]h:m[:s][.SSS] a][[ ]H:m[:s][.SSS]]");

  static final DateTimeFormatter POI_DATE_TIME = dateTimeFormatter();

  /** One of the formats DATEVALUE tries, in POI's order ({@code DateParser.Format}). */
  record DateValueFormat(Pattern pattern, boolean hasYear) {}

  /** POI's {@code DateParser} formats; private in POI, so pinned by a test that reads them. */
  static final List<DateValueFormat> DATE_VALUE_FORMATS =
      List.of(
          new DateValueFormat(Pattern.compile("^(\\d{4})-(\\w+)-(\\d{1,2})( .*)?$"), true),
          new DateValueFormat(Pattern.compile("^(\\d{1,2})-(\\w+)-(\\d{4})( .*)?$"), true),
          new DateValueFormat(Pattern.compile("^(\\w+)-(\\d{1,2})( .*)?$"), false),
          new DateValueFormat(Pattern.compile("^(\\w+)/(\\d{1,2})/(\\d{4})( .*)?$"), true),
          new DateValueFormat(Pattern.compile("^(\\d{4})/(\\w+)/(\\d{1,2})( .*)?$"), true),
          new DateValueFormat(Pattern.compile("^(\\w+)/(\\d{1,2})( .*)?$"), false));

  private ExcelDateText() {}

  private static DateTimeFormatter dateTimeFormatter() {
    var builder = new DateTimeFormatterBuilder();
    for (String pattern : POI_DATE_TIME_PATTERNS) builder.appendPattern(pattern);
    return builder.toFormatter(Locale.US);
  }

  /** Refuses text that a date-reading function would complete with a year from the clock. */
  static void refuseDatesWithoutYear(String function, List<Object> args) {
    if (!DATE_READERS.contains(function)) return;
    // TEXT reads only its value as a date; its format code stays text.
    List<Object> dates = function.equals("TEXT") ? args.subList(0, 1) : args;
    for (Object argument : dates)
      for (String text : texts(argument))
        if (needsYear(function, text))
          throw ArcException.invalid(
              function + ": date text needs a year, such as \"15 Jan 2026\"");
  }

  private static List<String> texts(Object argument) {
    if (argument instanceof String text) return List.of(text);
    if (!(argument instanceof List<?> items)) return List.of();
    var texts = new ArrayList<String>();
    for (Object item : items) texts.addAll(texts(item));
    return texts;
  }

  /** Whether POI would read the text as a date and take its year from the clock. */
  static boolean needsYear(String function, String text) {
    if (OperandResolver.parseDouble(text) != null) return false;
    if (function.equals("DATEVALUE")) {
      for (DateValueFormat format : DATE_VALUE_FORMATS)
        if (format.pattern().matcher(text).find()) return !format.hasYear();
      return false;
    }
    try {
      // POI collapses whitespace before parsing.
      TemporalAccessor parsed = POI_DATE_TIME.parse(text.replaceAll("\\s+", " "));
      return parsed.isSupported(ChronoField.MONTH_OF_YEAR)
          && !parsed.isSupported(ChronoField.YEAR_OF_ERA);
    } catch (DateTimeParseException notDateText) {
      return false;
    }
  }
}
