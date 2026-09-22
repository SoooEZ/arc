package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.engine.InputTypes;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import java.util.*;

/**
 * Declared parameter contracts and strict runtime value types; missing values remain caller-owned.
 */
final class InputValidation {
  static void validateSchema(List<Input> inputs) {
    Set<String> names = new HashSet<>();
    for (Input parameter : inputs) {
      require(
          parameter != null && Identifiers.isValid(parameter.name()),
          "Input names must be identifiers (letters, digits, underscores)");
      require(names.add(parameter.name()), "Duplicate input: " + parameter.name());
      require(
          Set.of("NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT")
              .contains(parameter.type() == null ? "" : parameter.type()),
          "Unknown input type");
      if (parameter.defaultValue() != null)
        InputTypes.check(parameter.name(), parameter.type(), parameter.defaultValue());
      if (parameter.source() != null) {
        var binding = parameter.source();
        require(
            binding.id() != null
                && binding.id().matches("[a-z][a-z0-9-]{0,79}")
                && binding.version() > 0,
            "Source needs an ID and version");
        require(
            binding.bindings() != null && binding.bindings().size() <= 20,
            "Source needs up to 20 mappings");
        for (var mapping : binding.bindings().entrySet())
          require(
              Identifiers.isValid(mapping.getKey())
                  && mapping.getValue() != null
                  && mapping.getValue().length() <= 2000,
              "Invalid source mapping");
        require(
            binding.pointer() == null
                || binding.pointer().isEmpty()
                || binding.pointer().startsWith("/") && binding.pointer().length() <= 500,
            "Use a JSON pointer starting with /");
        require(
            Set.of("FAIL", "DEFAULT").contains(binding.onError() == null ? "" : binding.onError()),
            "Choose FAIL or DEFAULT source error policy");
        require(
            !"DEFAULT".equals(binding.onError()) || parameter.defaultValue() != null,
            "Source fallback requires a default value");
      }
    }
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }

  private InputValidation() {}
}
