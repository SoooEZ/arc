package dev.arc.engine.validation;

import static dev.arc.engine.validation.DefinitionShape.require;

import dev.arc.engine.Identifiers;
import dev.arc.engine.InputTypes;
import dev.arc.engine.Limits;
import dev.arc.engine.validation.ShapeViolation.InputDeclaration;
import dev.arc.engine.validation.ShapeViolation.InputSource;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import java.util.*;

/**
 * Declared parameter contracts and strict runtime value types; missing values remain caller-owned.
 */
final class InputValidation {
  /**
   * Part of the draft shape: stops at the first violation, like {@link DefinitionShape}. Without
   * content checks only the names are checked, which is all the scope plan reads.
   */
  static void checkSchema(List<Input> inputs, boolean contentChecks) {
    Set<String> names = new HashSet<>();
    for (Input parameter : inputs) {
      var declaration = new InputDeclaration(parameter);
      require(
          parameter != null && Identifiers.isValid(parameter.name()),
          declaration,
          "Input names must be identifiers (letters, digits, underscores)");
      require(names.add(parameter.name()), declaration, "Duplicate input: " + parameter.name());
      if (!contentChecks) continue;
      require(
          InputTypes.Type.parse(parameter.type()).isPresent(), declaration, "Unknown input type");
      if (parameter.defaultValue() != null) checkDefault(parameter, declaration);
      if (parameter.source() != null) checkSource(parameter);
    }
  }

  private static void checkDefault(Input parameter, InputDeclaration declaration) {
    try {
      InputTypes.check(parameter.name(), parameter.type(), parameter.defaultValue());
    } catch (ArcException mismatch) {
      throw DefinitionShape.violation(declaration, mismatch.getMessage());
    }
  }

  private static void checkSource(Input parameter) {
    var source = new InputSource(parameter);
    var binding = parameter.source();
    require(
        Identifiers.isResourceId(binding.id()) && binding.version() > 0,
        source,
        "Source needs an ID and version");
    require(
        binding.bindings() != null && binding.bindings().size() <= Limits.MAX_SOURCE_MAPPINGS,
        source,
        "Source needs up to " + Limits.MAX_SOURCE_MAPPINGS + " mappings");
    for (var mapping : binding.bindings().entrySet())
      require(
          Identifiers.isValid(mapping.getKey())
              && mapping.getValue() != null
              && mapping.getValue().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
          source,
          "Invalid source mapping");
    require(
        binding.pointer() == null
            || binding.pointer().isEmpty()
            || binding.pointer().startsWith("/")
                && binding.pointer().length() <= Limits.MAX_POINTER_CHARACTERS,
        source,
        "Use a JSON pointer starting with /");
    require(
        SourceBinding.OnError.parse(binding.onError()).isPresent(),
        source,
        "Choose FAIL or DEFAULT source error policy");
    require(
        !binding.fallsBackToDefault() || parameter.defaultValue() != null,
        source,
        "Source fallback requires a default value");
  }

  private InputValidation() {}
}
