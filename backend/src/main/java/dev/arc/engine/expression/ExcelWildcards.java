package dev.arc.engine.expression;

import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.poi.ss.formula.eval.OperandResolver;
import org.apache.poi.ss.formula.functions.Countif;

/**
 * Bounds the work of Excel wildcard criteria before POI runs.
 *
 * <p>COUNTIF, SUMIF, MATCH, VLOOKUP, HLOOKUP, LOOKUP and the database functions turn {@code *} and
 * {@code ?} into a backtracking regular expression inside POI, where ARC's deadline cannot stop it:
 * {@code "*a*a*a*a*a*a*b"} against 2,000 characters of text would run for years. ARC compiles the
 * same expression with POI's own translation, replays it on the same text while counting the
 * characters it reads, and rejects the call once {@link #MAX_STEPS} are read. The regex engine is
 * deterministic, so POI's own matching of that text then reads at most as many characters. The
 * replay covers every text the function may test, so it can only over-estimate POI's work.
 */
final class ExcelWildcards {
  /** Characters that wildcard matching may read in one function call (tens of milliseconds). */
  static final int MAX_STEPS = 10_000_000;

  private static final Set<String> DATABASE_FUNCTIONS =
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

  private ExcelWildcards() {}

  /** Rejects the call when its wildcard criteria would need too much matching work in POI. */
  static void checkMatchingWork(String function, List<Object> args) {
    switch (function) {
      case "COUNTIF", "SUMIF" ->
          replay(function, criteriaPattern(args.get(1)), texts(args.getFirst()), Compilation.ONCE);
      case "MATCH", "LOOKUP" ->
          replay(function, lookupPattern(args.getFirst()), texts(args.get(1)), Compilation.ONCE);
      case "VLOOKUP" ->
          replay(
              function,
              lookupPattern(args.getFirst()),
              texts(firstColumn(args.get(1))),
              Compilation.ONCE);
      case "HLOOKUP" ->
          replay(
              function,
              lookupPattern(args.getFirst()),
              texts(firstRow(args.get(1))),
              Compilation.ONCE);
      default -> {
        if (DATABASE_FUNCTIONS.contains(function))
          replay(
              function,
              databasePatterns(args.get(2)),
              databaseTexts(args.getFirst()),
              Compilation.PER_TEST);
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
      String function, List<String> patterns, List<String> texts, Compilation compilation) {
    var budget = new Budget(function);
    for (String source : patterns) {
      Pattern pattern = Countif.StringMatcher.getWildCardPattern(source);
      if (pattern == null) continue;
      for (String text : texts) {
        // Starting a match costs work even when it reads nothing, and so does compiling again.
        budget.spend(compilation == Compilation.PER_TEST ? source.length() + 1 : 1);
        pattern.matcher(new MeteredText(text, budget)).matches();
      }
    }
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

  private static final class Budget {
    private final String function;
    private long remaining = MAX_STEPS;

    Budget(String function) {
      this.function = function;
    }

    void spend(int steps) {
      remaining -= steps;
      if (remaining < 0)
        throw ArcException.invalid(
            function
                + ": wildcard criteria need more than "
                + Limits.format(MAX_STEPS)
                + " character comparisons; use fewer * or shorter text");
    }
  }

  /** Text that charges one step to the budget for every character the regex reads. */
  private record MeteredText(String text, Budget budget) implements CharSequence {
    @Override
    public char charAt(int index) {
      budget.spend(1);
      return text.charAt(index);
    }

    @Override
    public int length() {
      return text.length();
    }

    @Override
    public CharSequence subSequence(int start, int end) {
      return new MeteredText(text.substring(start, end), budget);
    }

    @Override
    public String toString() {
      return text;
    }
  }
}
