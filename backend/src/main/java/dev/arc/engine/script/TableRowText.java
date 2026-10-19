package dev.arc.engine.script;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The text of a decision table row, {@code tests -> results}, whose cells are separated by {@code
 * |}. Separators count only outside quotes and brackets, as a statement's {@code ;} does, and a
 * {@code |} beside another is the {@code ||} operator of a result expression.
 */
final class TableRowText {
  private static final String ARROW = "->";

  /** A row's tests and results, the text before and after its first arrow. */
  record Parts(String tests, String results) {}

  private TableRowText() {}

  /** The row split at its first arrow outside quotes and brackets; empty without one. */
  static Optional<Parts> parts(String row) {
    for (int index : topLevel(row))
      if (row.startsWith(ARROW, index))
        return Optional.of(
            new Parts(row.substring(0, index).trim(), row.substring(index + 2).trim()));
    return Optional.empty();
  }

  /** The trimmed cells of one side of a row; text without a separator is one cell. */
  static List<String> cells(String side) {
    var cells = new ArrayList<String>();
    int start = 0;
    for (int index : topLevel(side))
      if (separates(side, index)) {
        cells.add(side.substring(start, index).trim());
        start = index + 1;
      }
    cells.add(side.substring(start).trim());
    return cells;
  }

  /**
   * Whether a cell written into a row reads back as that one cell: it scans as one value of a
   * statement and holds no separator or arrow outside quotes and brackets.
   */
  static boolean writesAsOneCell(String cell) {
    if (!ArcScriptScanner.scansAsOneValue(cell)) return false;
    for (int index : topLevel(cell))
      if (separates(cell, index) || cell.startsWith(ARROW, index)) return false;
    return true;
  }

  private static boolean separates(String text, int index) {
    return text.charAt(index) == '|'
        && (index == 0 || text.charAt(index - 1) != '|')
        && (index + 1 == text.length() || text.charAt(index + 1) != '|');
  }

  /** The indexes of the characters that stand outside quotes and brackets. */
  private static List<Integer> topLevel(String text) {
    var indexes = new ArrayList<Integer>();
    int nesting = 0;
    char quote = 0;
    boolean escape = false;
    for (int index = 0; index < text.length(); index++) {
      char c = text.charAt(index);
      if (quote != 0) {
        if (escape) escape = false;
        else if (c == '\\') escape = true;
        else if (c == quote) quote = 0;
        continue;
      }
      if (c == '"' || c == '\'') quote = c;
      else if (c == '(' || c == '[' || c == '{') nesting++;
      else if (c == ')' || c == ']' || c == '}') nesting--;
      else if (nesting == 0) indexes.add(index);
    }
    return indexes;
  }
}
