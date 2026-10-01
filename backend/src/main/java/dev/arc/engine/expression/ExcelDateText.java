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
 * DateUtil, which reads date text wherever a function takes a number, uses the year in which the
 * API process first loaded it, and DATEVALUE's parser the current year. Either is a hidden TODAY(),
 * which ARC leaves out because a published rule must not change with the date (NOW and TODAY are
 * reference-only). The functions that read dates refuse such text before POI runs: {@code $YEAR("1
 * Jan")} and {@code $INT("15 Jan")} are a 422 instead of a date in the year the process started.
 */
final class ExcelDateText {
  /**
   * The executable functions whose text arguments POI may read as dates: the date and time
   * functions, and the numeric ones that convert text through DateUtil. Every argument of these is
   * checked unless {@link #TEXT_ARGUMENTS} keeps it text. {@code ExcelDateTextTest} finds every
   * such function and argument in the catalog.
   */
  static final Set<String> DATE_READERS =
      Set.of(
          // Date and time.
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
          "TEXT",
          // Math and trigonometry.
          "ACOSH",
          "ASINH",
          "ATAN",
          "ATAN2",
          "CEILING",
          "COS",
          "DEGREES",
          "EVEN",
          "INT",
          "LN",
          "LOG",
          "LOG10",
          "MOD",
          "ODD",
          "POWER",
          "RADIANS",
          "SIN",
          "SQRT",
          "TAN",
          "TRUNC",
          // Number formatting and cell references.
          "ADDRESS",
          "DOLLAR",
          "FIXED",
          // Financial.
          "FV",
          "IPMT",
          "NPER",
          "NPV",
          "PMT",
          "PPMT",
          "PV",
          "RATE",
          // Arrays and statistics.
          "MDETERM",
          "MINVERSE",
          "MMULT",
          "PERCENTRANK",
          "TRANSPOSE");

  /** Arguments of a date reader that stay text, by index: TEXT's format code, ADDRESS's sheet. */
  private static final Map<String, Set<Integer>> TEXT_ARGUMENTS =
      Map.of("TEXT", Set.of(1), "ADDRESS", Set.of(4));

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
    Set<Integer> textArguments = TEXT_ARGUMENTS.getOrDefault(function, Set.of());
    for (int index = 0; index < args.size(); index++) {
      if (textArguments.contains(index)) continue;
      for (String text : texts(args.get(index)))
        if (needsYear(function, text))
          throw ArcException.invalid(
              function + ": date text needs a year, such as \"15 Jan 2026\"");
    }
  }

  private static List<String> texts(Object argument) {
    if (argument instanceof String text) return List.of(text);
    if (!(argument instanceof List<?> items)) return List.of();
    var texts = new ArrayList<String>();
    for (Object item : items) texts.addAll(texts(item));
    return texts;
  }

  /**
   * The longest text that can still be a date once POI collapses its whitespace: each numeric field
   * takes at most 19 digits. Longer text is never read as a date, so POI's number pattern, which
   * backtracks quadratically on long digit text (lesson B14), never runs on it here.
   */
  private static final int LONGEST_DATE_TEXT = 256;

  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  /** Whether POI would read the text as a date and take its year from the clock. */
  static boolean needsYear(String function, String text) {
    // DATEVALUE reads its text with its own formats only, which allow any trailing text.
    if (function.equals("DATEVALUE")) {
      for (DateValueFormat format : DATE_VALUE_FORMATS)
        if (format.pattern().matcher(text).find()) return !format.hasYear();
      return false;
    }
    // Elsewhere POI reads a number first, then date text with its whitespace collapsed.
    String collapsed = WHITESPACE.matcher(text).replaceAll(" ");
    if (collapsed.length() > LONGEST_DATE_TEXT) return false;
    if (OperandResolver.parseDouble(text) != null) return false;
    try {
      TemporalAccessor parsed = POI_DATE_TIME.parse(collapsed);
      return parsed.isSupported(ChronoField.MONTH_OF_YEAR)
          && !parsed.isSupported(ChronoField.YEAR_OF_ERA);
    } catch (DateTimeParseException notDateText) {
      return false;
    }
  }
}
