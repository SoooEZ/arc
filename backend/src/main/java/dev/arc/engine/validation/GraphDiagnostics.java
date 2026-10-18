package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Collects navigable problems in one pass of {@link GraphValidation#check}, even when an incomplete
 * graph has no scope plan. Each check runs once: every expression compiles once and the scope plan
 * is built once.
 */
final class GraphDiagnostics {
  private final GraphValidation graphValidation;

  GraphDiagnostics(GraphValidation graphValidation) {
    this.graphValidation = graphValidation;
  }

  Validator.Diagnosis diagnose(Definition definition, RuleResolver resolver) {
    var problems = new Problems(definition);
    var pins = new RejectedPins(resolver);
    GraphValidation.Pass pass = graphValidation.check(definition, pins, problems::add);
    if (!pass.shaped()) return new Validator.Diagnosis(problems.list(), false, List.of());
    var dependencies =
        RuleCalls.dependencies(definition, pass.expressions()::formulaCalls).stream()
            .filter(dependency -> !pins.rejected(dependency))
            .toList();
    return new Validator.Diagnosis(problems.list(), true, dependencies);
  }

  /**
   * Remembers the pins the graph checks could not resolve. Their problems are already reported, so
   * a later source-contract check must not resolve and report them again.
   */
  private static final class RejectedPins implements RuleResolver {
    private record Pin(String ruleId, int version, RuleCalls.Dependency.Call call) {}

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
        rejected.add(new Pin(id, version, RuleCalls.Dependency.Call.REFERENCE));
        throw error;
      }
    }

    @Override
    public Definition resolveFormula(String id, int version) {
      try {
        return delegate.resolveFormula(id, version);
      } catch (ArcException error) {
        rejected.add(new Pin(id, version, RuleCalls.Dependency.Call.FORMULA));
        throw error;
      }
    }

    boolean rejected(RuleCalls.Dependency dependency) {
      return rejected.contains(
          new Pin(dependency.ruleId(), dependency.version(), dependency.call()));
    }
  }
}
