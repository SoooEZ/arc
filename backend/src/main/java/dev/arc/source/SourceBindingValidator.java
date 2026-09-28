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
import java.util.Map;
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

  /**
   * A check of every callee version the walk reaches, once per version, besides its source
   * contracts: validate, diagnostics and publish make sure a pinned version can still be prepared,
   * or every execution of the new parent would fail (or answer a fallback).
   */
  @FunctionalInterface
  public interface CalleeCheck {
    CalleeCheck NONE = (callee, resolver) -> {};

    void check(Definition callee, RuleResolver resolver);
  }

  public void validate(Definition definition, RuleResolver resolver) {
    validate(definition, resolver, CalleeCheck.NONE);
  }

  public void validate(Definition definition, RuleResolver resolver, CalleeCheck calleeCheck) {
    validateContracts(
        definition,
        Validator.dependencies(definition),
        resolver,
        pinnedSources(),
        calleeCheck,
        new Walk(),
        0);
  }

  /** Execution: the engine prepares the callees itself. */
  public void validate(
      Definition definition,
      RuleResolver resolver,
      BiFunction<String, Integer, SourceDefinition> configurations) {
    validateContracts(
        definition,
        Validator.dependencies(definition),
        resolver,
        configurations,
        CalleeCheck.NONE,
        new Walk(),
        0);
  }

  /**
   * Diagnostics: visits the given dependencies instead of the definition's own, so the caller can
   * leave out pins whose problems it has already reported.
   */
  public void validate(
      Definition definition,
      RuleResolver resolver,
      List<Validator.Dependency> dependencies,
      CalleeCheck calleeCheck) {
    validateContracts(
        definition, dependencies, resolver, pinnedSources(), calleeCheck, new Walk(), 0);
  }

  /**
   * The pins one walk has reached. A pin is walked again when it is reached deeper than before,
   * because a deeper arrival has less headroom under the nesting limit: with one visit per pin, the
   * verdict depended on the order of the Reference nodes, and a root whose longer call path went
   * past the limit was published and then failed every execution. Each pin is walked at most
   * MAX_NESTING_DEPTH + 1 times, and its callee check runs once.
   */
  private static final class Walk {
    private final Map<String, Integer> deepest = new HashMap<>();
    private final Set<String> checked = new HashSet<>();

    boolean reaches(String pin, int depth) {
      Integer known = deepest.get(pin);
      if (known != null && known >= depth) return false;
      deepest.put(pin, depth);
      return true;
    }

    boolean firstCheck(String pin) {
      return checked.add(pin);
    }
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
      CalleeCheck calleeCheck,
      Walk walk,
      int depth) {
    if (depth > Limits.MAX_NESTING_DEPTH)
      throw ArcException.invalid("Rule nesting exceeds " + Limits.MAX_NESTING_DEPTH + " levels");
    for (Input input : definition.inputs())
      if (input.source() != null) validateSourceMappings(definition, input, configurations);
    for (var dependency : dependencies) {
      String pin = dependency.ruleId() + "@" + dependency.version();
      if (!walk.reaches(pin, depth + 1)) continue;
      try {
        Definition callee = dependency.resolve(resolver);
        if (walk.firstCheck(pin)) calleeCheck.check(callee, resolver);
        validateContracts(
            callee,
            Validator.dependencies(callee),
            resolver,
            configurations,
            calleeCheck,
            walk,
            depth + 1);
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
