package dev.arc.engine.validation;

import dev.arc.engine.table.CellTest;
import dev.arc.engine.table.DecisionTables;
import dev.arc.engine.table.DecisionTables.LiteralType;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.DecisionTable;
import dev.arc.model.Definition.Node;
import java.util.ArrayList;
import java.util.List;

/**
 * What an executable decision table needs beyond its expressions: columns, rows and named results,
 * and a test in every condition cell, each column testing one type of value. Draft shape has
 * checked its lists, labels, result names and row lengths. Overlapping rows, rows that never match
 * and values no row covers are not errors here: a run enforces its policy, and the editor points
 * them out.
 */
final class DecisionTableValidation {
  /** The first value a column tests that has a type, and the row that tests it. */
  private record ColumnType(LiteralType type, Object literal, int row) {}

  private DecisionTableValidation() {}

  /** At least one condition, one result and one row, and a name for every result. */
  static void requireParts(Node node) {
    DecisionTable table = node.table();
    require(!table.conditions().isEmpty(), node.label() + ": add at least one condition");
    require(!table.results().isEmpty(), node.label() + ": add at least one result");
    require(!table.rows().isEmpty(), node.label() + ": add at least one row");
    for (int column = 0; column < table.results().size(); column++) {
      DecisionTable.Result result = table.results().get(column);
      if (result.name().isEmpty())
        throw ArcException.invalid("name this result")
            .withContext(cellLabel(node, ExpressionPositions.tableResult(result, column)));
    }
  }

  /**
   * Parses every condition cell, row by row, and checks that each column tests one type of value
   * ({@code null} suits every column); the first problem names its cell.
   */
  static DecisionTables.Compiled compile(Node node) {
    DecisionTable table = node.table();
    var types = new ColumnType[table.conditions().size()];
    var tests = new ArrayList<List<CellTest>>();
    for (int row = 0; row < table.rows().size(); row++) {
      List<String> when = table.rows().get(row).when();
      var rowTests = new ArrayList<CellTest>();
      for (int column = 0; column < when.size(); column++) {
        String condition = ExpressionPositions.tableCondition(table.conditions().get(column));
        try {
          CellTest test = DecisionTables.test(when.get(column));
          types[column] = checkedType(test, row, types[column]);
          rowTests.add(test);
        } catch (ArcException error) {
          throw error.withContext(cellLabel(node, ExpressionPositions.tableCell(row, condition)));
        }
      }
      tests.add(rowTests);
    }
    return DecisionTables.compile(table, tests);
  }

  /** The column's type once this test is added; fails when it names a value of another type. */
  private static ColumnType checkedType(CellTest test, int row, ColumnType column) {
    for (Object literal : test.literals()) {
      LiteralType type = DecisionTables.typeOf(literal);
      if (type == null) continue;
      if (column == null) {
        column = new ColumnType(type, literal, row);
        continue;
      }
      if (column.type() == type) continue;
      String other =
          column.row() == row
              ? " and " + DecisionTables.described(column.literal())
              : ", but row "
                  + (column.row() + 1)
                  + " tests "
                  + DecisionTables.described(column.literal());
      throw ArcException.invalid(
          "tests "
              + DecisionTables.described(literal)
              + other
              + "; a column tests one type of value");
    }
    return column;
  }

  private static String cellLabel(Node node, String position) {
    return node.label() + " / " + position;
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
