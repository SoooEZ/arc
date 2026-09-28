package dev.arc.source;

import dev.arc.engine.Identifiers;
import dev.arc.engine.InputTypes;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import dev.arc.model.SourceDefinition.Field;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Checks the kind-independent source contract, then the registered adapter's configuration. The
 * name follows {@code DisplayNames}, the one policy rules share.
 */
@Component
public final class SourceValidator {
  private static final Set<String> PARAMETER_TYPES = Set.of("NUMBER", "STRING", "BOOLEAN");

  private final SourceAdapters adapters;

  public SourceValidator(SourceAdapters adapters) {
    this.adapters = adapters;
  }

  public void validate(SourceDefinition definition) {
    // A missing definition gets the same "Source kind must be ..." message as an unknown kind.
    var adapter = adapters.require(definition == null ? null : definition.kind());
    if (definition.parameters() == null
        || definition.parameters().size() > Limits.MAX_SOURCE_PARAMETERS)
      throw ArcException.invalid(
          "Provide up to " + Limits.MAX_SOURCE_PARAMETERS + " source parameters");
    Set<String> names = new HashSet<>();
    for (Input p : definition.parameters()) {
      if (p == null || !Identifiers.isValid(p.name()) || !names.add(p.name()) || p.source() != null)
        throw ArcException.invalid("Invalid source parameter");
      if (!PARAMETER_TYPES.contains(p.type() == null ? "" : p.type()))
        throw ArcException.invalid("Source parameters must be scalar");
      if (p.defaultValue() != null) InputTypes.check(p.name(), p.type(), p.defaultValue());
    }
    validateSecretHeaderShape(definition.secretHeaders());
    rejectUnusedFields(adapter, definition);
    adapter.validate(definition);
  }

  /**
   * A provider rejects the configuration it does not use, from the fields it declares: what it
   * would ignore was stored unbounded (HTTP entries of {@code 1E+5000} failed the read-back with a
   * 500) or reached executions that copy every stored value.
   */
  private static void rejectUnusedFields(SourceAdapter adapter, SourceDefinition definition) {
    for (Field field : Field.values())
      if (!adapter.fields().contains(field) && definition.sets(field))
        throw ArcException.invalid(adapter.noun() + " do not use " + describe(field));
  }

  private static String describe(Field field) {
    return switch (field) {
      case URL -> "a URL";
      case ENTRIES -> "lookup entries";
      case SECRET_HEADERS -> "secret headers";
    };
  }

  /**
   * Every stored version must copy safely into a request snapshot, whatever its kind; adapters
   * decide whether the kind uses secret headers and which names and aliases are allowed.
   */
  private static void validateSecretHeaderShape(Map<String, String> headers) {
    if (headers == null) return;
    for (var header : headers.entrySet())
      if (header.getKey() == null || header.getValue() == null)
        throw ArcException.invalid(
            "Secret headers map header names to uppercase environment aliases");
  }
}
