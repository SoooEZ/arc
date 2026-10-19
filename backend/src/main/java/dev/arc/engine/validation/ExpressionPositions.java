package dev.arc.engine.validation;

import dev.arc.model.Definition.BranchCase;
import dev.arc.model.Definition.DecisionTable;
import dev.arc.model.Definition.Field;

/**
 * How an expression's position inside its node is named: {@code Selector}, {@code Case Gold},
 * {@code Field cost}, a Reference binding's parameter, {@code rate source / key} for an Input
 * source mapping, and a decision table's {@code Condition Tier}, {@code Result fee} and {@code Row
 * 3 / Condition Tier}. Static diagnostics label problems with the node label and this position
 * ({@code Route / Case Gold}); runtime errors add the position alone, at the node's location. Both
 * read the wording here, so a failure is named alike wherever it is found.
 */
public final class ExpressionPositions {
  /** A Switch's optional selector. */
  public static final String SELECTOR = "Selector";

  private ExpressionPositions() {}

  public static String switchCase(BranchCase option) {
    return "Case " + option.label();
  }

  public static String transformField(Field field) {
    return "Field " + field.name();
  }

  /** A Reference binding is named by the callee parameter it binds. */
  public static String referenceBinding(String parameter) {
    return parameter;
  }

  /** A decision table's condition column, named by its label. */
  public static String tableCondition(DecisionTable.Condition condition) {
    return "Condition " + condition.label();
  }

  /** A decision table's result column, named by its name, or its number while it has none. */
  public static String tableResult(DecisionTable.Result result, int column) {
    String name =
        result == null || result.name() == null || result.name().isEmpty()
            ? String.valueOf(column + 1)
            : result.name();
    return "Result " + name;
  }

  /**
   * A cell of a decision table's row: {@code Row 3 / Condition Tier}, {@code Row 3 / Result fee}.
   */
  public static String tableCell(int row, String column) {
    return "Row " + (row + 1) + " / " + column;
  }

  /** An input's source mapping, named by the input and the source parameter it maps. */
  public static String sourceMapping(String input, String key) {
    return input + " source / " + key;
  }
}
