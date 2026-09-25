package dev.arc.source;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.InputTypes;
import dev.arc.engine.SourceReader;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
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
    return openSession().read(binding, inputs);
  }

  @Override
  public Object read(
      SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline) {
    return openSession().read(binding, inputs, deadline);
  }

  /** A request owns this cache; provider values remain live on every read. */
  public Session openSession() {
    return new Session();
  }

  public final class Session implements SourceReader {
    private record Version(String id, int version) {}

    private final Map<Version, DataSource> configurations = new HashMap<>();

    private Session() {}

    public SourceDefinition definition(String id, int version) {
      return source(id, version).definition();
    }

    private DataSource source(String id, int version) {
      return configurations.computeIfAbsent(
          new Version(id, version), ignored -> snapshot(repository.get(id, version)));
    }

    @Override
    public Object read(SourceBinding binding, Map<String, Object> inputs) {
      Object value = fetch(source(binding.id(), binding.version()), inputs);
      return extractor.extract(value, binding.pointer());
    }

    @Override
    public Object read(
        SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline) {
      deadline.check();
      DataSource source = source(binding.id(), binding.version());
      SourceDefinition definition = source.definition();
      Map<String, Object> values = normalizeInputs(definition, inputs);
      deadline.check();
      Object value =
          adapters.require(definition.kind()).fetch(source.id(), definition, values, deadline);
      deadline.check();
      return extractor.extract(value, binding.pointer());
    }
  }

  private DataSource snapshot(DataSource source) {
    SourceDefinition definition = source.definition();
    Map<String, Object> entries = null;
    if (definition.entries() != null) {
      entries = new LinkedHashMap<>();
      for (var entry : definition.entries().entrySet())
        entries.put(entry.getKey(), immutableValue(entry.getValue()));
      entries = Collections.unmodifiableMap(entries);
    }
    return new DataSource(
        source.id(),
        source.name(),
        source.version(),
        new SourceDefinition(
            definition.kind(),
            definition.url(),
            List.copyOf(definition.parameters()),
            entries,
            definition.secretHeaders() == null ? null : Map.copyOf(definition.secretHeaders()),
            definition.timeoutMs()));
  }

  private Object immutableValue(Object value) {
    if (value instanceof Map<?, ?> map) {
      var copy = new LinkedHashMap<Object, Object>();
      for (var entry : map.entrySet()) copy.put(entry.getKey(), immutableValue(entry.getValue()));
      return Collections.unmodifiableMap(copy);
    }
    if (value instanceof List<?> list) {
      var copy = new ArrayList<>();
      for (Object item : list) copy.add(immutableValue(item));
      return Collections.unmodifiableList(copy);
    }
    return value;
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
