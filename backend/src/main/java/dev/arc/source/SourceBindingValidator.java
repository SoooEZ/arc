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
import org.springframework.stereotype.Component;

/**
 * Validates pinned contracts only: every source mapping of the definition and of each rule it
 * reaches names declared parameters and maps the ones a caller must supply. It never performs
 * external IO. The three entry points differ in where configurations come from, which pins are
 * walked and what else a reached version must pass; one {@link Walk} runs each check.
 */
@Component
public final class SourceBindingValidator {
  private final SourceVersions versions;

  public SourceBindingValidator(SourceVersions versions) {
    this.versions = versions;
  }

  /**
   * A check of every callee version the walk reaches, once per version, besides its source
   * contracts: validate, diagnostics and publish make sure a pinned version can still be prepared,
   * or every execution of the new parent would fail (or answer a fallback).
   */
  @FunctionalInterface
  public interface CalleeCheck {
    CalleeCheck NONE = (ruleId, version, callee) -> {};

    void check(String ruleId, int version, Definition callee);
  }

  /**
   * Validate and publish: reads the stored configurations and walks every pin the definition
   * reaches, checking each callee version once.
   */
  public void validatePinnedContracts(
      Definition definition, RuleResolver resolver, CalleeCheck calleeCheck) {
    new Walk(resolver, pinnedSources(), calleeCheck)
        .visit(definition, Validator.dependencies(definition), 0);
  }

  /**
   * Execution: reads configurations through the request's session, so validation and the runtime
   * reads share one snapshot per version, and walks every pin; the engine prepares the callees.
   */
  public void validateForExecution(
      Definition definition, RuleResolver resolver, SourceConfigurations session) {
    new Walk(resolver, session, CalleeCheck.NONE)
        .visit(definition, Validator.dependencies(definition), 0);
  }

  /**
   * Diagnostics: reads the stored configurations and walks only {@code unreported}, the pins whose
   * problems the graph checks have not reported already, so each fault has one owner.
   */
  public void validateRemainingPins(
      Definition definition,
      RuleResolver resolver,
      List<Validator.Dependency> unreported,
      CalleeCheck calleeCheck) {
    new Walk(resolver, pinnedSources(), calleeCheck).visit(definition, unreported, 0);
  }

  /**
   * The pinned configurations, through the frozen versions that executions read, so a version is
   * read from storage once per process; each is looked up once per check.
   */
  private SourceConfigurations pinnedSources() {
    var configurations = new HashMap<String, SourceDefinition>();
    return (id, version) ->
        configurations.computeIfAbsent(
            id + "@" + version, ignored -> versions.get(id, version).definition());
  }

  /**
   * One check's walk over a definition and the pins it reaches. A pin is walked again when it is
   * reached deeper than before, because a deeper arrival has less headroom under the nesting limit:
   * with one visit per pin, the verdict depended on the order of the Reference nodes, and a root
   * whose longer call path went past the limit was published and then failed every execution. Each
   * pin is walked at most MAX_NESTING_DEPTH + 1 times, and its callee check runs once.
   */
  private static final class Walk {
    private final RuleResolver resolver;
    private final SourceConfigurations configurations;
    private final CalleeCheck calleeCheck;
    private final Map<String, Integer> deepest = new HashMap<>();
    private final Set<String> checked = new HashSet<>();

    Walk(RuleResolver resolver, SourceConfigurations configurations, CalleeCheck calleeCheck) {
      this.resolver = resolver;
      this.configurations = configurations;
      this.calleeCheck = calleeCheck;
    }

    void visit(Definition definition, List<Validator.Dependency> dependencies, int depth) {
      if (depth > Limits.MAX_NESTING_DEPTH)
        throw ArcException.invalid("Rule nesting exceeds " + Limits.MAX_NESTING_DEPTH + " levels");
      for (Input input : definition.inputs())
        if (input.source() != null) validateSourceMappings(definition, input, configurations);
      for (var dependency : dependencies) {
        String pin = dependency.ruleId() + "@" + dependency.version();
        if (!reaches(pin, depth + 1)) continue;
        try {
          Definition callee = dependency.resolve(resolver);
          if (checked.add(pin))
            calleeCheck.check(dependency.ruleId(), dependency.version(), callee);
          visit(callee, Validator.dependencies(callee), depth + 1);
        } catch (ArcException error) {
          throw error
              .inRule(dependency.ruleId(), dependency.version())
              .atNode(null, null, dependency.nodeId(), dependency.label());
        }
      }
    }

    private boolean reaches(String pin, int depth) {
      Integer known = deepest.get(pin);
      if (known != null && known >= depth) return false;
      deepest.put(pin, depth);
      return true;
    }
  }

  private static void validateSourceMappings(
      Definition definition, Input input, SourceConfigurations configurations) {
    try {
      var binding = input.source();
      var configuration = configurations.get(binding.id(), binding.version());
      var names = configuration.parameters().stream().map(Input::name).toList();
      for (String key : binding.bindings().keySet())
        if (!names.contains(key)) throw ArcException.invalid("Unknown source parameter: " + key);
      // Source parameters are never sourced themselves (SourceValidator), so the one rule applies.
      for (Input parameter : configuration.parameters())
        if (parameter.needsCallerValue() && !binding.bindings().containsKey(parameter.name()))
          throw ArcException.invalid(
              input.name() + ": missing source mapping for " + parameter.name());
    } catch (ArcException error) {
      throw Validator.onInputNode(error, definition);
    }
  }
}
