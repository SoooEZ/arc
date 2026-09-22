package dev.arc.source;

import dev.arc.engine.Identifiers;
import dev.arc.engine.InputTypes;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.HashSet;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public final class SourceValidator {
  private final SourceAdapters adapters;

  public SourceValidator(SourceAdapters adapters) {
    this.adapters = adapters;
  }

  public void validate(String name, SourceDefinition c) {
    if (name == null || name.isBlank() || name.length() > 160)
      throw ArcException.invalid("Source name must contain 1–160 characters");
    if (c == null) throw ArcException.invalid("Source kind must be HTTP or LOOKUP");
    var adapter = adapters.require(c.kind());
    if (c.parameters() == null || c.parameters().size() > 20)
      throw ArcException.invalid("Provide up to 20 source parameters");
    Set<String> names = new HashSet<>();
    for (Input p : c.parameters()) {
      if (p == null || !Identifiers.isValid(p.name()) || !names.add(p.name()) || p.source() != null)
        throw ArcException.invalid("Invalid source parameter");
      if (!Set.of("NUMBER", "STRING", "BOOLEAN").contains(p.type() == null ? "" : p.type()))
        throw ArcException.invalid("Source parameters must be scalar");
      if (p.defaultValue() != null) InputTypes.check(p.name(), p.type(), p.defaultValue());
    }
    adapter.validate(c);
  }
}
