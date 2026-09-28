package dev.arc.source;

import dev.arc.engine.Limits;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.SourceDefinition;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.BiFunction;
import org.springframework.stereotype.Component;

/** Validates pinned contracts only. It never performs external IO. */
@Component
public final class SourceBindingValidator {
  private final SourceRepository sources;

  public SourceBindingValidator(SourceRepository sources) {
    this.sources = sources;
  }

  public void validate(Definition definition, RuleResolver resolver) {
    validate(definition, resolver, pinnedSources());
  }

  public void validate(
      Definition definition,
      RuleResolver resolver,
      BiFunction<String, Integer, SourceDefinition> configurations) {
    validateContracts(
        definition,
        Validator.dependencies(definition),
        resolver,
        configurations,
        new HashSet<>(),
        0);
  }

  /**
   * Diagnostics: visits the given dependencies instead of the definition's own, so the caller can
   * leave out pins whose problems it has already reported.
   */
  public void validate(
      Definition definition, RuleResolver resolver, List<Validator.Dependency> dependencies) {
    validateContracts(definition, dependencies, resolver, pinnedSources(), new HashSet<>(), 0);
  }

  private BiFunction<String, Integer, SourceDefinition> pinnedSources() {
    var configurations = new HashMap<String, SourceDefinition>();
    return (id, version) ->
        configurations.computeIfAbsent(
            id + "@" + version, ignored -> sources.get(id, version).definition());
  }

  private void validateContracts(
      Definition definition,
      List<Validator.Dependency> dependencies,
      RuleResolver resolver,
      BiFunction<String, Integer, SourceDefinition> configurations,
      Set<String> visited,
      int depth) {
    if (depth > Limits.MAX_NESTING_DEPTH)
      throw ArcException.invalid("Rule nesting exceeds " + Limits.MAX_NESTING_DEPTH + " levels");
    for (Input input : definition.inputs())
      if (input.source() != null) validateSourceMappings(definition, input, configurations);
    for (var dependency : dependencies) {
      if (!visited.add(dependency.ruleId() + "@" + dependency.version())) continue;
      try {
        Definition callee = dependency.resolve(resolver);
        validateContracts(
            callee, Validator.dependencies(callee), resolver, configurations, visited, depth + 1);
      } catch (ArcException error) {
        throw error
            .inRule(dependency.ruleId(), dependency.version())
            .atNode(null, null, dependency.nodeId(), dependency.label());
      }
    }
  }

  private void validateSourceMappings(
      Definition definition,
      Input input,
      BiFunction<String, Integer, SourceDefinition> configurations) {
    try {
      var binding = input.source();
      var configuration = configurations.apply(binding.id(), binding.version());
      var names = configuration.parameters().stream().map(Input::name).toList();
      for (String key : binding.bindings().keySet())
        if (!names.contains(key)) throw ArcException.invalid("Unknown source parameter: " + key);
      for (Input parameter : configuration.parameters())
        if (parameter.required()
            && parameter.defaultValue() == null
            && !binding.bindings().containsKey(parameter.name()))
          throw ArcException.invalid(
              input.name() + ": missing source mapping for " + parameter.name());
    } catch (ArcException error) {
      throw Validator.onInputNode(error, definition);
    }
  }
}
