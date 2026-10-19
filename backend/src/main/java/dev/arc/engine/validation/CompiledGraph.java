package dev.arc.engine.validation;

import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.table.DecisionTables;
import dev.arc.model.Definition;
import java.util.Map;

/**
 * A validated definition with its scope plan, immutable expressions and decision tables (by node
 * ID); evaluation state belongs to each execution.
 */
public record CompiledGraph(
    Definition definition,
    GraphPlan plan,
    Map<String, Expressions.Compiled> expressions,
    Map<String, DecisionTables.Compiled> tables) {
  public CompiledGraph {
    expressions = Map.copyOf(expressions);
    tables = Map.copyOf(tables);
  }

  public DecisionTables.Compiled table(String nodeId) {
    var table = tables.get(nodeId);
    if (table == null) throw new IllegalStateException("Decision table was not validated");
    return table;
  }

  public Expressions.Compiled expression(String source) {
    var expression = expressions.get(source);
    if (expression == null) throw new IllegalStateException("Expression was not validated");
    return expression;
  }
}
