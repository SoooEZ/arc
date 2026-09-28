package dev.arc.engine.validation;

import dev.arc.model.Definition.BranchCase;
import dev.arc.model.Definition.Field;

/**
 * How an expression's position inside its node is named: {@code Selector}, {@code Case Gold},
 * {@code Field cost}, a Reference binding's parameter and {@code rate source / key} for an Input
 * source mapping. Static diagnostics label problems with the node label and this position ({@code
 * Route / Case Gold}); runtime errors add the position alone, at the node's location. Both read the
 * wording here, so a failure is named alike wherever it is found.
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

  /** An input's source mapping, named by the input and the source parameter it maps. */
  public static String sourceMapping(String input, String key) {
    return input + " source / " + key;
  }
}
