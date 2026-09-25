package dev.arc.engine.validation;

import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.model.Definition;
import java.util.Map;

/** Validated graph and immutable expressions; evaluation state belongs to each execution. */
public record CompiledGraph(
    Definition definition, GraphPlan graph, Map<String, Expressions.Compiled> expressions) {
  public CompiledGraph {
    expressions = Map.copyOf(expressions);
  }

  public Expressions.Compiled expression(String source) {
    var expression = expressions.get(source);
    if (expression == null) throw new IllegalStateException("Expression was not validated");
    return expression;
  }
}
