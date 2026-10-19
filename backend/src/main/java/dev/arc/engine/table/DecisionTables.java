package dev.arc.engine.table;

import dev.arc.engine.ValueText;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.DecisionTable;
import dev.arc.model.Definition.DecisionTable.HitPolicy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Decision table cells and row matching: the test grammar ({@link CellParser}), the rule that one
 * condition column tests one type of value, and the rows a hit policy selects. Validation compiles
 * a table once ({@link #compile}); executions of the plan share it.
 */
public final class DecisionTables {
  /** The longest text of a value a message repeats. */
  private static final int SHOWN_CHARACTERS = 40;

  private DecisionTables() {}

  /** The kind of value a test names, for the rule that one column tests one type. */
  public enum LiteralType {
    NUMBER,
    TEXT,
    BOOLEAN
  }

  /** A condition cell's test; fails with a message that says what a test can be. */
  public static CellTest test(String cell) {
    return CellParser.parse(cell);
  }

  /** The type of a value a test names; null for {@code null}, which every column may test. */
  public static LiteralType typeOf(Object literal) {
    if (literal instanceof Number) return LiteralType.NUMBER;
    if (literal instanceof String) return LiteralType.TEXT;
    if (literal instanceof Boolean) return LiteralType.BOOLEAN;
    return null;
  }

  /** A test's value as a message names it: "the number 100", "the text "gold"". */
  public static String described(Object literal) {
    return switch (typeOf(literal)) {
      case NUMBER -> "the number " + shown(literal);
      case TEXT -> "the text " + shown(literal);
      case BOOLEAN -> "the boolean " + shown(literal);
      case null -> "null";
    };
  }

  /**
   * A table ready to match: its policy, the labels that name its columns and each row's tests,
   * {@code tests.get(row).get(column)}. The caller has parsed every cell with {@link #test}.
   */
  public static Compiled compile(DecisionTable table, List<List<CellTest>> tests) {
    var labels = new ArrayList<String>();
    for (DecisionTable.Condition condition : table.conditions()) labels.add(condition.label());
    var rows = new ArrayList<List<CellTest>>();
    for (List<CellTest> row : tests) rows.add(List.copyOf(row));
    return new Compiled(table.policy(), labels, rows);
  }

  /** An immutable compiled table, shared by every execution of a plan. */
  public static final class Compiled {
    private final HitPolicy policy;
    private final List<String> labels;
    private final List<List<CellTest>> rows;

    private Compiled(HitPolicy policy, List<String> labels, List<List<CellTest>> rows) {
      this.policy = policy;
      this.labels = List.copyOf(labels);
      this.rows = List.copyOf(rows);
    }

    public HitPolicy policy() {
      return policy;
    }

    /**
     * The rows the policy selects for the condition values, numbered from 0 in table order. FIRST
     * stops at the first row whose tests all hold and UNIQUE checks every row; both fail when no
     * row matches, and UNIQUE when several do. COLLECT returns every matching row, perhaps none. A
     * row's tests are checked column by column and stop at the first that fails.
     */
    public List<Integer> select(List<Object> values) {
      for (int column = 0; column < values.size(); column++)
        requireComparable(labels.get(column), values.get(column));
      var matched = new ArrayList<Integer>();
      for (int row = 0; row < rows.size(); row++) {
        if (!matches(row, values)) continue;
        matched.add(row);
        if (policy == HitPolicy.FIRST) break;
      }
      if (policy == HitPolicy.COLLECT) return matched;
      if (matched.isEmpty()) throw ArcException.invalid("No row matches " + named(values));
      if (matched.size() > 1)
        throw ArcException.invalid(
            rowNumbers(matched)
                + (matched.size() == 2 ? " both match " : " match ")
                + named(values)
                + "; with one match only, rows must not overlap");
      return matched;
    }

    private boolean matches(int row, List<Object> values) {
      List<CellTest> tests = rows.get(row);
      for (int column = 0; column < tests.size(); column++) {
        Object value = values.get(column);
        try {
          if (!tests.get(column).holds(value)) return false;
        } catch (CellTest.Mismatch notANumber) {
          throw ArcException.invalid(
              labels.get(column)
                  + " is "
                  + kindOf(value)
                  + ", but row "
                  + (row + 1)
                  + " compares it with a number");
        }
      }
      return true;
    }

    /** "Tier "gold", Order amount 150": every column with its value. */
    private String named(List<Object> values) {
      var parts = new ArrayList<String>();
      for (int column = 0; column < values.size(); column++)
        parts.add(labels.get(column) + " " + shown(values.get(column)));
      return String.join(", ", parts);
    }
  }

  /**
   * Tests compare scalars, as a Switch's values do; an array or an object fails before any row is
   * checked.
   */
  private static void requireComparable(String label, Object value) {
    if (value instanceof List<?> || value instanceof Map<?, ?>)
      throw ArcException.invalid(
          label
              + " is "
              + (value instanceof List<?> ? "an array" : "an object")
              + "; a decision table compares numbers, text, true/false or null");
  }

  /** "the text ("abc")" for a value an ordering test cannot compare. */
  private static String kindOf(Object value) {
    if (value instanceof String) return "text (" + shown(value) + ")";
    return "a boolean (" + shown(value) + ")";
  }

  /** "Rows 1 and 3", "Rows 1, 3 and 4": the rows numbered from 1. */
  private static String rowNumbers(List<Integer> rows) {
    var numbers = new ArrayList<String>();
    for (int row : rows) numbers.add(String.valueOf(row + 1));
    String last = numbers.removeLast();
    return "Rows " + String.join(", ", numbers) + " and " + last;
  }

  /**
   * A scalar as a message shows it, as ARC writes the literal: text in double quotes with quotes
   * and backslashes escaped, numbers in plain notation, true, false and null; cut after a few dozen
   * characters.
   */
  static String shown(Object value) {
    if (!(value instanceof String text)) return cut(String.valueOf(ValueText.text(value)));
    String escaped = text.replace("\\", "\\\\").replace("\"", "\\\"");
    return "\"" + cut(escaped) + "\"";
  }

  private static String cut(String text) {
    return text.length() <= SHOWN_CHARACTERS ? text : text.substring(0, SHOWN_CHARACTERS) + "…";
  }
}
