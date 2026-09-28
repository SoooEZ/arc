package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/**
 * Collects navigable problems in one pass, even when an incomplete graph has no scope plan. Each
 * check runs once: every expression compiles once and the scope plan is built once.
 */
final class GraphDiagnostics {
  private final DefinitionShape documentShape;
  private final NodeValidation nodeValidation;
  private final GraphValidation graphValidation;

  GraphDiagnostics(
      DefinitionShape documentShape,
      NodeValidation nodeValidation,
      GraphValidation graphValidation) {
    this.documentShape = documentShape;
    this.nodeValidation = nodeValidation;
    this.graphValidation = graphValidation;
  }

  Validator.Diagnosis diagnose(Definition definition, RuleResolver resolver) {
    var problems = new Problems(definition);
    var violation = documentShape.firstViolation(definition);
    if (violation.isPresent()) {
      // Later checks assume a well-formed document.
      problems.add(DefinitionShape.located(violation.get(), definition));
      return new Validator.Diagnosis(problems.list(), false, List.of());
    }
    var pins = new RejectedPins(resolver);
    var expressions = new ExpressionCache();
    GraphPlan plan = scopePlan(definition, problems);
    for (Node node : definition.nodes()) {
      try {
        if (plan == null) nodeValidation.syntax(node, pins, expressions);
        else
          nodeValidation.validate(
              definition, node, plan.available().get(node.id()), pins, expressions);
      } catch (ArcException error) {
        problems.add(error);
      }
    }
    var inputReads =
        graphValidation.checkSourceMappings(definition, expressions, pins, problems::add);
    try {
      graphValidation.checkStructure(definition, inputReads, plan);
    } catch (ArcException error) {
      problems.add(error);
    }
    var dependencies =
        NodeValidation.dependencies(definition, expressions::formulaCalls).stream()
            .filter(dependency -> !pins.rejected(dependency))
            .toList();
    return new Validator.Diagnosis(problems.list(), true, dependencies);
  }

  /** A cyclic or too complex graph has no scope plan; its nodes still get syntax checks. */
  private static GraphPlan scopePlan(Definition definition, Problems problems) {
    try {
      return new GraphPlan(definition);
    } catch (ArcException error) {
      problems.add(error);
      return null;
    }
  }

  /**
   * Remembers the pins the graph checks could not resolve. Their problems are already reported, so
   * a later source-contract check must not resolve and report them again.
   */
  private static final class RejectedPins implements RuleResolver {
    private record Pin(String ruleId, int version, Validator.Dependency.Call call) {}

    private final RuleResolver delegate;
    private final Set<Pin> rejected = new HashSet<>();

    RejectedPins(RuleResolver delegate) {
      this.delegate = delegate;
    }

    @Override
    public Definition resolve(String id, int version) {
      try {
        return delegate.resolve(id, version);
      } catch (ArcException error) {
        rejected.add(new Pin(id, version, Validator.Dependency.Call.REFERENCE));
        throw error;
      }
    }

    @Override
    public Definition resolveFormula(String id, int version) {
      try {
        return delegate.resolveFormula(id, version);
      } catch (ArcException error) {
        rejected.add(new Pin(id, version, Validator.Dependency.Call.FORMULA));
        throw error;
      }
    }

    boolean rejected(Validator.Dependency dependency) {
      return rejected.contains(
          new Pin(dependency.ruleId(), dependency.version(), dependency.call()));
    }
  }
}
