package dev.arc.rule;

import dev.arc.engine.MemoizingRuleResolver;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.NodeKind;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceBindingValidator.CalleeCheck;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Static graph checks and source contracts. Never fetches external parameter values. */
@Service
public class RuleDefinitionService {
  /**
   * Result of {@code /studio/expression/check}: the free variables and Formula calls of a valid
   * expression, or the error of an invalid one. The field order is the JSON order.
   */
  public record ExpressionCheck(
      boolean valid,
      Set<String> variables,
      String error,
      List<Expressions.FormulaCall> formulaCalls) {}

  private final Validator validator;
  private final RuleResolver rules;
  private final SourceBindingValidator sources;
  private final Engine engine;

  public RuleDefinitionService(
      Validator validator, RuleRepository rules, SourceBindingValidator sources, Engine engine) {
    this.validator = validator;
    this.rules = rules;
    this.sources = sources;
    this.engine = engine;
  }

  /**
   * The editor's check ({@code POST /validate}), outside any transaction: pins an execution or an
   * earlier editor check has compiled are read from their plans, and the plans compiled for the
   * pins it reaches are kept ({@link Engine#check}). Every diagnostics request, sent 350 ms after
   * each semantic edit, read, decoded and compiled every reached pin again before.
   */
  public void validate(Definition definition) {
    var check = engine.check(new MemoizingRuleResolver(engine.cachedFirst(rules)));
    check(definition, check.resolver(), check::prepare);
  }

  /**
   * A publication's check, inside its transaction: it reuses cached plans but keeps none of its
   * own, because it may read versions its transaction has not committed ({@link
   * Engine#prepareForCheck}, lesson B34).
   */
  public void validateForPublication(Definition definition) {
    var resolver = new MemoizingRuleResolver(engine.cachedFirst(rules));
    check(
        definition,
        resolver,
        (ruleId, version, callee) -> engine.prepareForCheck(ruleId, version, callee, resolver));
  }

  /**
   * A reached pin's version must still compile: one holding a property its kind does not use, or an
   * unprefixed call, passed every static check and then failed every execution of the parent.
   */
  private void check(Definition definition, RuleResolver resolver, CalleeCheck calleesCompile) {
    validator.validate(definition, resolver);
    sources.validatePinnedContracts(definition, resolver, calleesCompile);
  }

  public ExpressionCheck checkExpression(String source) {
    try {
      var expression = Expressions.compile(source);
      Validator.validateFormulaCalls(expression, new MemoizingRuleResolver(rules));
      return new ExpressionCheck(true, expression.variables(), null, expression.formulaCalls());
    } catch (ArcException error) {
      return new ExpressionCheck(false, Set.of(), error.getMessage(), List.of());
    }
  }

  /** Scopes depend on the graph's structure alone: invalid structure or a cycle still fails. */
  public Map<String, Set<String>> variables(Definition definition) {
    validator.structure(definition);
    return new GraphPlan(definition).available();
  }

  /**
   * Graph problems, then the first source-contract problem. Pin and syntax problems belong to the
   * graph checks, so the source-contract check skips the pins they rejected. Like {@link
   * #validate}, it keeps the plans of the pins it reaches.
   */
  public List<Validator.Problem> diagnostics(Definition definition) {
    var check = engine.check(new MemoizingRuleResolver(engine.cachedFirst(rules)));
    var diagnosis = validator.diagnose(definition, check.resolver());
    var problems = new ArrayList<>(diagnosis.problems());
    if (diagnosis.shaped() && hasOneInputNode(definition)) {
      try {
        sources.validateRemainingPins(
            definition, check.resolver(), diagnosis.dependencies(), check::prepare);
      } catch (ArcException error) {
        problems.add(Validator.Problem.from(error));
      }
    }
    return problems;
  }

  /** Source problems are shown on the Input node, so they need exactly one. */
  private static boolean hasOneInputNode(Definition definition) {
    return definition.nodesOf(NodeKind.INPUT).size() == 1;
  }
}
