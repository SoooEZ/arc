package dev.arc.source.lookup;

import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceAdapter;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public final class LookupSourceAdapter implements SourceAdapter {
  @Override
  public String kind() {
    return "LOOKUP";
  }

  @Override
  public void validate(SourceDefinition definition) {
    if (!definition.parameters().stream()
        .map(Input::name)
        .collect(Collectors.toSet())
        .equals(Set.of("key")))
      throw ArcException.invalid("Lookup tables require exactly one parameter named key");
    if (definition.entries() == null || definition.entries().size() > 1000)
      throw ArcException.invalid("Provide a JSON object with at most 1,000 lookup entries");
    Expressions.bounded(definition.entries());
  }

  @Override
  public Object fetch(String sourceId, SourceDefinition definition, Map<String, Object> inputs) {
    String key = String.valueOf(inputs.get("key"));
    if (!definition.entries().containsKey(key))
      throw ArcException.invalid("Lookup key was not found in " + sourceId);
    return definition.entries().get(key);
  }
}
