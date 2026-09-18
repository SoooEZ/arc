package dev.arc.source;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.HashSet;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Validates pinned contracts only. It never performs external IO. */
@Component
public final class SourceBindingValidator {
  private final SourceRepository sources;

  public SourceBindingValidator(SourceRepository sources) {
    this.sources = sources;
  }

  public void validate(Definition definition, RuleResolver resolver) {
    validateBindings(definition, resolver, new HashSet<>(), 0);
  }

  private void validateBindings(
      Definition d, RuleResolver resolver, Set<String> visited, int depth) {
    if (depth > 16) throw ArcException.invalid("Rule nesting exceeds 16 levels");
    for (Input p : d.inputs())
      if (p.source() != null) {
        try {
          var b = p.source();
          var c = sources.get(b.id(), b.version()).definition();
          var names = c.parameters().stream().map(Input::name).toList();
          for (String k : b.bindings().keySet())
            if (!names.contains(k)) throw ArcException.invalid("Unknown source parameter: " + k);
          for (Input arg : c.parameters())
            if (arg.required()
                && arg.defaultValue() == null
                && !b.bindings().containsKey(arg.name()))
              throw ArcException.invalid(p.name() + ": missing source mapping for " + arg.name());
        } catch (ArcException e) {
          Node input =
              d.nodes().stream().filter(n -> n.type().equals("INPUT")).findFirst().orElseThrow();
          throw e.atNode(null, null, input.id(), input.label());
        }
      }
    for (Node n : d.nodes())
      if (n.type().equals("REFERENCE")
          && n.ruleId() != null
          && n.version() != null
          && visited.add(n.ruleId() + "@" + n.version()))
        try {
          validateBindings(resolver.resolve(n.ruleId(), n.version()), resolver, visited, depth + 1);
        } catch (ArcException e) {
          throw e.inRule(n.ruleId(), n.version()).atNode(null, null, n.id(), n.label());
        }
  }
}
