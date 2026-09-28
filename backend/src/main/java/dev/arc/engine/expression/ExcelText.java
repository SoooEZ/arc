package dev.arc.engine.expression;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.poi.ss.format.CellFormatPart;
import org.apache.poi.ss.format.CellFormatResult;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DateUtil;

/**
 * {@code $TEXT} without POI's process-wide formatter caches.
 *
 * <p>POI's TEXT formats through one static DataFormatter that keeps every format code it has seen,
 * and DataFormatter hands codes with several sections to CellFormat, whose static cache never
 * shrinks either. Format codes built from data would therefore grow the heap until the server
 * fails. This class repeats POI's TEXT steps with a DataFormatter per call and applies
 * multi-section codes through POI's public {@link CellFormatPart}, following CellFormat's section
 * rules. The text matches POI's; nothing outlives the call. {@link ExcelFunctionAdapter} pins the
 * locale and time zone.
 */
final class ExcelText {
  private static final Locale LOCALE = Locale.US;

  /** DataFormatter's test for a two-section code with a condition, such as "[>=100]0;0.0". */
  private static final Pattern CONDITIONAL_CODE =
      Pattern.compile(".*\\[\\s*(>|>=|<|<=|=)\\s*[0-9]*\\.*[0-9].*");

  /** CellFormat's section splitter, built from POI's public section grammar. */
  private static final Pattern SECTION =
      Pattern.compile(
          CellFormatPart.FORMAT_PAT.pattern() + "(;|$)",
          Pattern.COMMENTS | Pattern.CASE_INSENSITIVE);

  /** CellFormat's text when no section of a two-section code applies to the value. */
  private static final String NO_APPLICABLE_SECTION = "\"" + "#".repeat(255) + "\"";

  private ExcelText() {}

  /** POI's {@code TEXT(value, format)} for scalar arguments, with #VALUE! as an error value. */
  static ValueEval evaluate(ValueEval value, ValueEval format) {
    try {
      return new StringEval(text(value, format));
    } catch (RuntimeException | StackOverflowError unformattable) {
      // POI's TEXT answers #VALUE! for anything it cannot format. The section grammar recurses per
      // character, so a long multi-section code can exhaust the stack; CellFormat catches it too.
      return ErrorEval.VALUE_INVALID;
    }
  }

  private static String text(ValueEval value, ValueEval format) {
    if (value instanceof BoolEval flag) return flag.getStringValue();
    if (value instanceof StringEval string) {
      Double number = numberOrDate(string.getStringValue());
      return number == null ? string.getStringValue() : format(number, code(format));
    }
    if (value instanceof NumericValueEval number)
      return format(number.getNumberValue(), code(format));
    if (value == BlankEval.instance) return format(0, code(format));
    throw new IllegalArgumentException("TEXT formats a single value");
  }

  /** POI formats text that reads as a number, or else as a date or time, and returns other text. */
  private static Double numberOrDate(String text) {
    Double number = OperandResolver.parseDouble(text);
    if (number != null) return number;
    try {
      return DateUtil.parseDateTime(text);
    } catch (RuntimeException notADate) {
      return null;
    }
  }

  /** The format code: text as written, a number as its text and a blank as "". */
  private static String code(ValueEval format) {
    if (format == BlankEval.instance) return "";
    if (format instanceof StringValueEval code && !(format instanceof BoolEval))
      return code.getStringValue();
    throw new IllegalArgumentException("TEXT needs a format code");
  }

  private static String format(double number, String code) {
    String normalized = code.replace("\\%", "'%'");
    if (hasSections(normalized)) return formatSections(number, code, normalized);
    return new DataFormatter(LOCALE).formatRawCellContents(number, -1, code);
  }

  /** The codes that DataFormatter would hand to CellFormat and its process-wide cache. */
  private static boolean hasSections(String code) {
    return code.contains(";")
        && (code.indexOf(';') != code.lastIndexOf(';') || CONDITIONAL_CODE.matcher(code).matches());
  }

  /** DataFormatter's handling of CellFormat's result: trimmed, with Excel's "E+" exponent sign. */
  private static String formatSections(double number, String code, String normalized) {
    Object cellValue =
        number != 0 && DateUtil.isADateFormat(-1, normalized)
            ? DateUtil.getJavaDate(number, false)
            : (Object) number;
    String result = Sections.of(normalized).apply(cellValue).text.trim();
    if (DateUtil.isADateFormat(-1, code) && DateUtil.isValidExcelDate(number)) return result;
    String lowerCase = code.toLowerCase(Locale.ROOT);
    boolean exponentFormat = lowerCase.contains("general") || lowerCase.contains("e+0");
    return exponentFormat && result.contains("E") && !result.contains("E-")
        ? result.replaceFirst("E", "E+")
        : result;
  }

  /**
   * One parsed section. POI keeps whether a section has a condition package-private, so it is read
   * from the same public grammar. A section POI cannot read is null, as in CellFormat, and using it
   * fails the call.
   */
  private record Section(CellFormatPart part, boolean conditional) {
    static Section parse(String source) {
      try {
        var part = new CellFormatPart(LOCALE, source);
        Matcher grammar = CellFormatPart.FORMAT_PAT.matcher(source);
        String operator =
            grammar.matches() ? grammar.group(CellFormatPart.CONDITION_OPERATOR_GROUP) : null;
        return new Section(part, operator != null && !operator.isEmpty());
      } catch (RuntimeException unreadable) {
        return null;
      }
    }

    static Section of(String code) {
      return new Section(new CellFormatPart(LOCALE, code), false);
    }

    boolean applies(double value) {
      return part.applies(value);
    }

    CellFormatResult apply(Object value) {
      return part.apply(value);
    }
  }

  /** CellFormat's choice between positive, negative, zero and text sections, uncached. */
  private record Sections(List<Section> sections) {
    static Sections of(String code) {
      var sections = new ArrayList<Section>();
      Matcher matcher = SECTION.matcher(code);
      while (matcher.find()) {
        String source = matcher.group();
        if (source.endsWith(";")) source = source.substring(0, source.length() - 1);
        sections.add(Section.parse(source));
      }
      if (sections.isEmpty()) throw new IllegalArgumentException("TEXT format has no sections");
      return new Sections(sections);
    }

    CellFormatResult apply(Object cellValue) {
      if (cellValue instanceof Date date) {
        double serial = DateUtil.getExcelDate(date);
        if (!DateUtil.isValidExcelDate(serial))
          throw new IllegalArgumentException("Not a valid Excel date");
        return applicable(serial).apply(date);
      }
      if (!(cellValue instanceof Double number))
        throw new IllegalArgumentException("TEXT formats a number or date");
      if (number < 0 && negativeSectionTakesAbsoluteValue()) return negative().apply(-number);
      return applicable(number).apply(number);
    }

    /** Without conditions, a negative number is written unsigned in the negative section. */
    private boolean negativeSectionTakesAbsoluteValue() {
      return switch (sections.size()) {
        case 2 -> !positive().conditional() && !negative().conditional();
        case 3, 4 -> !negative().conditional();
        default -> false;
      };
    }

    private Section applicable(double value) {
      if (sections.size() == 1) {
        Section positive = positive();
        return !positive.conditional() || positive.applies(value)
            ? positive
            : Section.of("General");
      }
      if (sections.size() == 2) {
        if (positive().conditional() ? positive().applies(value) : value >= 0) return positive();
        if (!negative().conditional() || negative().applies(value)) return negative();
        return Section.of(NO_APPLICABLE_SECTION);
      }
      if (positive().conditional() ? positive().applies(value) : value > 0) return positive();
      if (negative().conditional() ? negative().applies(value) : value < 0) return negative();
      return zero();
    }

    private Section positive() {
      return readable(0);
    }

    private Section negative() {
      return readable(1);
    }

    private Section zero() {
      return readable(2);
    }

    private Section readable(int index) {
      Section section = sections.get(index);
      if (section == null) throw new IllegalArgumentException("TEXT format section is unreadable");
      return section;
    }
  }
}
