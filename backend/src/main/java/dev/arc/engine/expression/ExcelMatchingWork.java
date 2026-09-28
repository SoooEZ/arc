package dev.arc.engine.expression;

import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.formula.eval.OperandResolver;
import org.apache.poi.ss.formula.functions.Countif;

/**
 * Bounds the work of POI's regular expressions over range text before POI runs.
 *
 * <p>Two POI patterns backtrack on user text inside one call that ARC's deadline cannot stop.
 * COUNTIF, SUMIF, MATCH, VLOOKUP, HLOOKUP, LOOKUP and the database functions turn {@code *} and
 * {@code ?} into a wildcard expression: {@code "*a*a*a*a*a*a*b"} against 2,000 characters of text
 * would run for years. COUNTIF and SUMIF with a numeric criterion, and the two-range statistics
 * CORREL, COVAR, PEARSON and FORECAST, parse every text cell with POI's number pattern, which
 * backtracks quadratically on a long run of digits: 2,000 digits followed by a letter cost about 70
 * ms, and a 1,000-cell range holds a request thread for minutes. ARC compiles the same expressions
 * (the wildcard through POI's own translation, the number pattern as a pinned copy), replays them
 * on the same text while counting the characters it reads, and rejects the call once {@link
 * #MAX_STEPS} are read. The regex engine is deterministic, so POI's own matching of that text then
 * reads at most as many characters. The replay covers every text the function may test, so it can
 * only over-estimate POI's work.
 */
final class ExcelMatchingWork {
  /** Characters that pattern matching may read in one function call (tens of milliseconds). */
  static final int MAX_STEPS = 10_000_000;

  /**
   * POI's {@code OperandResolver.fpPattern}, which decides whether text counts as a number. POI
   * keeps it private, so this copy is pinned by a test that reads POI's field.
   */
  static final String POI_NUMBER_PATTERN =
      "[\\x00-\\x20]*[+-]?(((\\p{Digit}+)(\\.)?((\\p{Digit}+)?)([eE][+-]?(\\p{Digit}+))?)"
          + "|(\\.(\\p{Digit}+)([eE][+-]?(\\p{Digit}+))?))[\\x00-\\x20]*";

  private static final Pattern NUMBER = Pattern.compile(POI_NUMBER_PATTERN);

  /** The database functions: a database range, one field and a criteria range. */
  static final Set<String> DATABASE_FUNCTIONS =
      Set.of(
          "DAVERAGE",
          "DCOUNT",
          "DCOUNTA",
          "DGET",
          "DMAX",
          "DMIN",
          "DPRODUCT",
          "DSTDEV",
          "DSTDEVP",
          "DSUM",
          "DVAR",
          "DVARP");

  /** COUNTIF and SUMIF read these comparisons before the criterion, longest first. */
  private static final List<String> COMPARISONS = List.of("<>", "<=", ">=", "=", "<", ">");

  /** Statistics that parse the text cells of both of their ranges as numbers. */
  private static final Set<String> TWO_RANGE_STATISTICS =
      Set.of("CORREL", "COVAR", "PEARSON", "FORECAST");

  private ExcelMatchingWork() {}

  /** Rejects the call when its criteria or number parsing would need too much work in POI. */
  static void checkMatchingWork(String function, List<Object> args) {
    var budget = new Budget(function);
    switch (function) {
      case "COUNTIF", "SUMIF" -> {
        Object criterion = args.get(1);
        List<String> cells = texts(args.getFirst());
        replay(budget, criteriaPattern(criterion), cells, Compilation.ONCE);
        if (parsesCellsAsNumbers(criterion, budget)) replayNumbers(budget, cells);
      }
      case "MATCH", "LOOKUP" ->
          replay(budget, lookupPattern(args.getFirst()), texts(args.get(1)), Compilation.ONCE);
      case "VLOOKUP" ->
          replay(
              budget,
              lookupPattern(args.getFirst()),
              texts(firstColumn(args.get(1))),
              Compilation.ONCE);
      case "HLOOKUP" ->
          replay(
              budget,
              lookupPattern(args.getFirst()),
              texts(firstRow(args.get(1))),
              Compilation.ONCE);
      default -> {
        if (DATABASE_FUNCTIONS.contains(function))
          replay(
              budget,
              databasePatterns(args.get(2)),
              databaseTexts(args.getFirst()),
              Compilation.PER_TEST);
        if (TWO_RANGE_STATISTICS.contains(function))
          for (Object range : args.subList(args.size() - 2, args.size()))
            replayNumbers(budget, texts(range));
      }
    }
  }

  /**
   * COUNTIF and SUMIF match text against a wildcard only after no comparison, {@code =} or {@code
   * <>}. Ordering comparisons such as {@code >a*} compare text instead.
   */
  private static List<String> criteriaPattern(Object criterion) {
    if (!(criterion instanceof String text)) return List.of();
    for (String comparison : COMPARISONS) {
      if (!text.startsWith(comparison)) continue;
      boolean matchesText = comparison.equals("=") || comparison.equals("<>");
      return matchesText ? List.of(text.substring(comparison.length())) : List.of();
    }
    return List.of(text);
  }

  /**
   * POI parses every text cell as a number when the criterion is a number, or numeric text after no
   * comparison or {@code =}; {@code <>5} matches every text cell without parsing, and ordering
   * comparisons match none.
   */
  private static boolean parsesCellsAsNumbers(Object criterion, Budget budget) {
    if (criterion instanceof Number) return true;
    if (!(criterion instanceof String text)) return false;
    for (String comparison : COMPARISONS) {
      if (!text.startsWith(comparison)) continue;
      if (!comparison.equals("=")) return false;
      return isNumberText(text.substring(comparison.length()), budget);
    }
    return isNumberText(text, budget);
  }

  private static boolean isNumberText(String text, Budget budget) {
    budget.spend(1, Work.NUMBER_TEXT);
    return NUMBER.matcher(new MeteredText(text, budget, Work.NUMBER_TEXT)).matches();
  }

  private static List<String> lookupPattern(Object lookupValue) {
    return lookupValue instanceof String text ? List.of(text) : List.of();
  }

  /** Database criteria may hold a condition in any cell; POI lower-cases conditions and cells. */
  private static List<String> databasePatterns(Object criteria) {
    var patterns = new ArrayList<String>();
    for (String condition : texts(criteria)) patterns.add(condition.toLowerCase(Locale.US));
    return patterns;
  }

  /** Database cells are compared as text, including numbers, booleans and blanks (""). */
  private static List<String> databaseTexts(Object database) {
    var texts = new ArrayList<String>();
    for (Object cell : cells(database)) {
      String text =
          cell == null ? "" : OperandResolver.coerceValueToString(ExcelFunctionAdapter.value(cell));
      texts.add(text.toLowerCase(Locale.US));
    }
    return texts;
  }

  private static void replay(
      Budget budget, List<String> patterns, List<String> texts, Compilation compilation) {
    for (String source : patterns) {
      Pattern pattern = Countif.StringMatcher.getWildCardPattern(source);
      if (pattern == null) continue;
      for (String text : texts) {
        // Starting a match costs work even when it reads nothing, and so does compiling again.
        budget.spend(compilation == Compilation.PER_TEST ? source.length() + 1 : 1, Work.WILDCARDS);
        pattern.matcher(new MeteredText(text, budget, Work.WILDCARDS)).matches();
      }
    }
  }

  private static void replayNumbers(Budget budget, List<String> texts) {
    for (String text : texts) isNumberText(text, budget);
  }

  /** VLOOKUP tests the first cell of every row; a flat array is one column. */
  private static List<Object> firstColumn(Object table) {
    if (!(table instanceof List<?> rows)) return List.of(table);
    var column = new ArrayList<Object>();
    for (Object row : rows)
      column.add(row instanceof List<?> cells && !cells.isEmpty() ? cells.getFirst() : row);
    return column;
  }

  /** HLOOKUP tests the first row; a flat array is one column, so only its first cell. */
  private static List<Object> firstRow(Object table) {
    if (!(table instanceof List<?> rows) || rows.isEmpty()) return List.of();
    Object first = rows.getFirst();
    return first instanceof List<?> cells ? new ArrayList<>(cells) : List.of(first);
  }

  private static List<String> texts(Object value) {
    var texts = new ArrayList<String>();
    for (Object cell : cells(value)) {
      if (cell instanceof String text) texts.add(text);
    }
    return texts;
  }

  private static List<Object> cells(Object value) {
    var cells = new ArrayList<Object>();
    if (value instanceof List<?> items) {
      for (Object item : items) cells.addAll(cells(item));
    } else {
      cells.add(value);
    }
    return cells;
  }

  /** Whether POI compiles a criterion once per call or again for every value it tests. */
  private enum Compilation {
    ONCE,
    PER_TEST
  }

  /** The POI pattern whose replay is charged; the rejection names the work that ran out. */
  private enum Work {
    WILDCARDS(
        "wildcard criteria need more than %s character comparisons; use fewer * or shorter text"),
    NUMBER_TEXT("numeric text needs more than %s character comparisons; use shorter text");

    private final String excess;

    Work(String excess) {
      this.excess = excess;
    }
  }

  /** One call's budget, shared by its wildcard and number replays. */
  private static final class Budget {
    private final String function;
    private long remaining = MAX_STEPS;

    Budget(String function) {
      this.function = function;
    }

    void spend(int steps, Work work) {
      remaining -= steps;
      if (remaining < 0)
        throw ArcException.invalid(
            function + ": " + String.format(work.excess, Limits.format(MAX_STEPS)));
    }
  }

  /** Text that charges one step to the budget for every character the regex reads. */
  private record MeteredText(String text, Budget budget, Work work) implements CharSequence {
    @Override
    public char charAt(int index) {
      budget.spend(1, work);
      return text.charAt(index);
    }

    @Override
    public int length() {
      return text.length();
    }

    @Override
    public CharSequence subSequence(int start, int end) {
      return new MeteredText(text.substring(start, end), budget, work);
    }

    @Override
    public String toString() {
      return text;
    }
  }
}
