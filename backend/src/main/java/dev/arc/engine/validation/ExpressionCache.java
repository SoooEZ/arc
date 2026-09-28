package dev.arc.engine.validation;

import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Compiles each distinct expression text at most once per validation pass. Failures are remembered
 * too, so an expression used in several places is not parsed again.
 */
final class ExpressionCache {
  private final Map<String, Expressions.Compiled> compiled = new HashMap<>();
  private final Map<String, ArcException> failures = new HashMap<>();

  Expressions.Compiled compile(String source) {
    var expression = compiled.get(source);
    if (expression != null) return expression;
    var failure = failures.get(source);
    if (failure != null) throw failure;
    try {
      expression = Expressions.compile(source);
    } catch (ArcException error) {
      failures.put(source, error);
      throw error;
    }
    compiled.put(source, expression);
    return expression;
  }

  /** Formula calls of an expression this pass compiled; none when it failed or was not reached. */
  List<Expressions.FormulaCall> formulaCalls(String source) {
    var expression = compiled.get(source);
    return expression == null ? List.of() : expression.formulaCalls();
  }

  /** Every successfully compiled expression, keyed by its source text. */
  Map<String, Expressions.Compiled> compiled() {
    return compiled;
  }
}
