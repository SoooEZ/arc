package dev.arc.rule;

import dev.arc.engine.MemoizingRuleResolver;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceBindingValidator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import org.springframework.stereotype.Service;

/** Static graph checks and source contracts. Never fetches external parameter values. */
@Service
public class RuleDefinitionService {
  private final Validator validator;
  private final RuleResolver rules;
  private final SourceBindingValidator sources;

  public RuleDefinitionService(
      Validator validator, RuleRepository rules, SourceBindingValidator sources) {
    this.validator = validator;
    this.rules = rules;
    this.sources = sources;
  }

  public void validate(Definition definition) {
    validate(definition, new MemoizingRuleResolver(rules));
  }

  public void validate(Definition definition, RuleResolver resolver) {
    validator.validate(definition, resolver);
    sources.validate(definition, resolver);
  }

  public void validateSources(
      Definition definition,
      RuleResolver resolver,
      BiFunction<String, Integer, SourceDefinition> lookup) {
    sources.validate(definition, resolver, lookup);
  }

  public Map<String, Set<String>> variables(Definition definition) {
    validator.shape(definition);
    return new GraphPlan(definition).available();
  }

  public List<Validator.Problem> diagnostics(Definition definition) {
    var resolver = new MemoizingRuleResolver(rules);
    var problems = validator.diagnostics(definition, resolver);
    try {
      validator.shape(definition);
      if (definition.nodes().stream().filter(n -> n.type().equals("INPUT")).count() == 1)
        sources.validate(definition, resolver);
    } catch (ArcException e) {
      if (!e.locations().isEmpty()) {
        var problem = Validator.Problem.from(e);
        if (!problems.contains(problem)) problems.add(problem);
      }
    }
    return problems;
  }
}
