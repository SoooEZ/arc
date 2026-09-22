package dev.arc.source;

import dev.arc.engine.InputTypes;
import dev.arc.engine.SourceReader;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Resolves one source version, normalizes its inputs, and dispatches the provider read. */
@Service
public class SourceExecutionService implements SourceReader {
  public record Test(Map<String, Object> inputs, Integer version) {}

  private final SourceRepository repository;
  private final SourceAdapters adapters;
  private final JsonPointerExtractor extractor;

  public SourceExecutionService(
      SourceRepository repository, SourceAdapters adapters, JsonPointerExtractor extractor) {
    this.repository = repository;
    this.adapters = adapters;
    this.extractor = extractor;
  }

  public Object test(String id, Test request) {
    DataSource source =
        request.version() == null ? repository.latest(id) : repository.get(id, request.version());
    return fetch(source, request.inputs());
  }

  @Override
  public Object read(SourceBinding binding, Map<String, Object> inputs) {
    Object value = fetch(repository.get(binding.id(), binding.version()), inputs);
    return extractor.extract(value, binding.pointer());
  }

  private Object fetch(DataSource source, Map<String, Object> inputs) {
    SourceDefinition definition = source.definition();
    Map<String, Object> values = normalizeInputs(definition, inputs);
    return adapters.require(definition.kind()).fetch(source.id(), definition, values);
  }

  private Map<String, Object> normalizeInputs(
      SourceDefinition definition, Map<String, Object> inputs) {
    if (inputs == null) throw ArcException.invalid("Source inputs must be an object");
    for (String name : inputs.keySet()) {
      if (definition.parameters().stream().noneMatch(parameter -> parameter.name().equals(name)))
        throw ArcException.invalid("Unknown source parameter: " + name);
    }

    var values = new LinkedHashMap<String, Object>();
    for (Input parameter : definition.parameters()) {
      // Explicit null is a supplied value; only an omitted key uses the default.
      Object value =
          inputs.containsKey(parameter.name())
              ? inputs.get(parameter.name())
              : parameter.defaultValue();
      if (value == null && parameter.required())
        throw ArcException.invalid("Missing source parameter: " + parameter.name());
      values.put(
          parameter.name(),
          value == null ? null : InputTypes.check(parameter.name(), parameter.type(), value));
    }
    return values;
  }
}
