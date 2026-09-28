package dev.arc.source;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.InputTypes;
import dev.arc.engine.SourceReader;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Resolves one source version, normalizes its inputs, and dispatches the provider read. Rule
 * executions read through a request {@link Session}, which is the engine's {@link SourceReader}.
 */
@Service
public class SourceExecutionService {
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

  /** Reads the whole provider value of the current or a pinned version, like one execution. */
  public Object test(String id, Test request) {
    DataSource source =
        request.version() == null ? repository.latest(id) : repository.get(id, request.version());
    return fetch(
        source, request.inputs(), ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS));
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

    /** One stored configuration per request, shared by static validation and every read. */
    private DataSource source(String id, int version) {
      return configurations.computeIfAbsent(new Version(id, version), ignored -> load(id, version));
    }

    /** Providers receive an unmodifiable copy, so no read can change what later reads see. */
    private DataSource load(String id, int version) {
      DataSource source = repository.get(id, version);
      return new DataSource(
          source.id(), source.name(), source.version(), source.definition().detached());
    }

    @Override
    public Object read(
        SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline) {
      deadline.check();
      Object value = fetch(source(binding.id(), binding.version()), inputs, deadline);
      return extractor.extract(value, binding.pointer());
    }
  }

  private Object fetch(DataSource source, Map<String, Object> inputs, ExecutionDeadline deadline) {
    SourceDefinition definition = source.definition();
    Map<String, Object> values = normalizeInputs(definition, inputs);
    deadline.check();
    Object value =
        adapters.require(definition.kind()).fetch(source.id(), definition, values, deadline);
    deadline.check();
    return value;
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
