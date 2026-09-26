package dev.arc.engine.expression;

import dev.arc.engine.expression.Functions.Entry;
import java.util.*;

/** Curated editor documentation; support and invocation limits stay with the catalog. */
final class ExcelFunctionHelp {
  private record Help(String category, String signature, String description, String snippet) {
    Entry applyTo(Entry entry) {
      return new Entry(
          entry.name(),
          category,
          signature,
          description,
          snippet,
          entry.supported(),
          entry.origin());
    }
  }

  private static final Map<String, Help> HELP = create();

  static Entry describe(Entry entry) {
    Help help = HELP.get(entry.name());
    return help == null ? entry : help.applyTo(entry);
  }

  private static Map<String, Help> create() {
    var help = new HashMap<String, Help>();
    add(
        help,
        "LEFT",
        "Text",
        "LEFT(text, characters = 1)",
        "Takes characters from the start of a string.",
        "LEFT(${1:\"text\"}, ${2:3})");
    add(
        help,
        "RIGHT",
        "Text",
        "RIGHT(text, characters = 1)",
        "Takes characters from the end of a string.",
        "RIGHT(${1:\"text\"}, ${2:3})");
    add(
        help,
        "MID",
        "Text",
        "MID(text, start, count)",
        "Extracts characters; start is one-based.",
        "MID(${1:\"hello\"}, ${2:2}, ${3:3})");
    add(help, "LEN", "Text", "LEN(text)", "Counts characters in a string.", "LEN(${1:\"text\"})");
    add(
        help,
        "FIND",
        "Text",
        "FIND(needle, text, start = 1)",
        "Returns the one-based, case-sensitive position. Missing text is an error.",
        "FIND(${1:\"a\"}, ${2:\"arc\"})");
    add(
        help,
        "SEARCH",
        "Text",
        "SEARCH(needle, text, start = 1)",
        "Finds a case-insensitive, one-based text position.",
        "SEARCH(${1:\"a\"}, ${2:\"ARC\"})");
    add(
        help,
        "SUBSTITUTE",
        "Text",
        "SUBSTITUTE(text, old, replacement, occurrence?)",
        "Replaces all matches, or only the selected occurrence.",
        "SUBSTITUTE(${1:\"hello\"}, ${2:\"l\"}, ${3:\"r\"})");
    add(
        help,
        "TEXT",
        "Text",
        "TEXT(value, format)",
        "Formats a number using an Excel format string.",
        "TEXT(${1:amount}, ${2:\"0.00\"})");
    for (String n : List.of("UPPER", "LOWER", "PROPER", "TRIM", "CLEAN"))
      add(
          help,
          n,
          "Text",
          n + "(text)",
          "Transforms text: letter case, whitespace, or nonprinting characters.",
          n + "(${1:\"text\"})");
    add(
        help,
        "REPT",
        "Text",
        "REPT(text, count)",
        "Repeats text. ARC limits the result to 2,000 characters.",
        "REPT(${1:\"x\"}, ${2:3})");
    add(
        help,
        "VLOOKUP",
        "Lookup",
        "VLOOKUP(key, table, column, approximate = true)",
        "Searches the first column. Columns are one-based; false requests an exact match."
            + " Approximate tables must be sorted.",
        "VLOOKUP(${1:key}, ${2:[[1, 10], [2, 20]]}, ${3:2}, false)");
    add(
        help,
        "HLOOKUP",
        "Lookup",
        "HLOOKUP(key, table, row, approximate = true)",
        "Searches the first row. Rows are one-based; false requests an exact match.",
        "HLOOKUP(${1:key}, ${2:[[1, 2], [10, 20]]}, ${3:2}, false)");
    add(
        help,
        "INDEX",
        "Lookup",
        "INDEX(array, row, column?)",
        "Returns a one-based position within an array or matrix.",
        "INDEX(${1:values}, ${2:1}, ${3:1})");
    add(
        help,
        "MATCH",
        "Lookup",
        "MATCH(key, array, matchType = 1)",
        "Returns a one-based matching position. Use 0 for an exact match.",
        "MATCH(${1:key}, ${2:values}, 0)");
    add(
        help,
        "COUNTIF",
        "Statistics",
        "COUNTIF(range, criteria)",
        "Counts cells matching an Excel criterion such as >10 or a text value.",
        "COUNTIF(${1:values}, ${2:\">10\"})");
    add(
        help,
        "SUMIF",
        "Statistics",
        "SUMIF(range, criteria, sumRange?)",
        "Sums matching cells, optionally from a separate range.",
        "SUMIF(${1:values}, ${2:\">10\"})");
    add(
        help,
        "SUMPRODUCT",
        "Math",
        "SUMPRODUCT(array, ...)",
        "Multiplies matching positions then adds the products.",
        "SUMPRODUCT(${1:prices}, ${2:quantities})");
    add(
        help,
        "ROUNDUP",
        "Math",
        "ROUNDUP(number, digits = 0)",
        "Rounds away from zero.",
        "ROUNDUP(${1:amount}, ${2:2})");
    for (String n : List.of("MEDIAN", "STDEV", "STDEVP", "VAR", "VARP", "GEOMEAN"))
      add(
          help,
          n,
          "Statistics",
          n + "(number or array, ...)",
          "Calculates an Excel statistical measure over the supplied numeric values.",
          n + "(${1:values})");
    add(
        help,
        "DATE",
        "Date & time",
        "DATE(year, month, day)",
        "Returns an Excel serial date (1900 date system). No system clock is read.",
        "DATE(${1:2026}, ${2:9}, ${3:16})");
    for (String n : List.of("YEAR", "MONTH", "DAY", "WEEKDAY"))
      add(
          help,
          n,
          "Date & time",
          n + "(serialDate)",
          "Extracts a calendar component from an Excel serial date.",
          n + "(${1:\\$DATE(2026, 9, 16)})");
    add(
        help,
        "PMT",
        "Finance",
        "PMT(rate, periods, presentValue, futureValue = 0, type = 0)",
        "Calculates a periodic payment using a rate per period. Type 0 pays at period end.",
        "PMT(${1:0.05 / 12}, ${2:60}, ${3:10000})");
    add(
        help,
        "NPV",
        "Finance",
        "NPV(rate, cashflow, ...)",
        "Discounts future cash flows at a constant per-period rate.",
        "NPV(${1:0.1}, ${2:[100, 200, 300]})");
    return Map.copyOf(help);
  }

  private static void add(
      Map<String, Help> help,
      String name,
      String category,
      String signature,
      String description,
      String snippet) {
    help.put(name, new Help(category, signature, description, snippet));
  }

  private ExcelFunctionHelp() {}
}
