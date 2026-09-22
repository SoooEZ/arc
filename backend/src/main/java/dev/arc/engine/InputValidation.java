package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import java.util.*;

/**
 * Declared parameter contracts and strict runtime value types; missing values remain caller-owned.
 */
final class InputValidation {
  static boolean identifier(String name) {
    return name != null
        && name.matches("[A-Za-z_][A-Za-z_0-9]{0,63}")
        && !Set.of("true", "false", "null", "and", "or").contains(name.toLowerCase(Locale.ROOT));
  }

  static void validateSchema(List<Input> inputs) {
    Set<String> names = new HashSet<>();
    for (Input parameter : inputs) {
      require(
          parameter != null && identifier(parameter.name()),
          "Input names must be identifiers (letters, digits, underscores)");
      require(names.add(parameter.name()), "Duplicate input: " + parameter.name());
      require(
          Set.of("NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT")
              .contains(parameter.type() == null ? "" : parameter.type()),
          "Unknown input type");
      if (parameter.defaultValue() != null)
        checkType(parameter.name(), parameter.type(), parameter.defaultValue());
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
              identifier(mapping.getKey())
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

  static Object checkType(String name, String type, Object value) {
    boolean valid =
        switch (type) {
          case "NUMBER" -> value instanceof Number;
          case "STRING" -> value instanceof String;
          case "BOOLEAN" -> value instanceof Boolean;
          case "ARRAY" -> value instanceof List<?>;
          case "OBJECT" -> value instanceof Map<?, ?>;
          default -> false;
        };
    require(valid, "Input '" + name + "' must be " + type.toLowerCase());
    return value instanceof Number ? Expressions.number(value) : Expressions.bounded(value);
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }

  private InputValidation() {}
}
