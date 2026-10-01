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

  private record Version(String id, int version) {}

  private final SourceRepository repository;
  private final SourceVersions versions;
  private final SourceAdapters adapters;
  private final JsonPointerExtractor extractor;

  /**
   * Pinned versions come from the frozen {@link SourceVersions}, and each request still snapshots
   * one configuration per version in its {@link Session}.
   */
  public SourceExecutionService(
      SourceRepository repository,
      SourceVersions versions,
      SourceAdapters adapters,
      JsonPointerExtractor extractor) {
    this.repository = repository;
    this.versions = versions;
    this.adapters = adapters;
    this.extractor = extractor;
  }

  /** Reads the whole provider value of the current or a pinned version, like one execution. */
  public Object test(String id, Test request) {
    DataSource source =
        request.version() == null ? repository.latest(id) : repository.get(id, request.version());
    return fetch(
        source.id(),
        source.definition(),
        request.inputs(),
        ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS));
  }

  /** A request owns this cache; provider values remain live on every read. */
  public Session openSession() {
    return new Session();
  }

  public final class Session implements SourceReader {
    private final Map<Version, SourceDefinition> configurations = new HashMap<>();

    private Session() {}

    /** One stored configuration per request, shared by static validation and every read. */
    public SourceDefinition definition(String id, int version) {
      return configurations.computeIfAbsent(
          new Version(id, version), ignored -> versions.get(id, version));
    }

    @Override
    public Object read(
        SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline) {
      deadline.check();
      Object value =
          fetch(binding.id(), definition(binding.id(), binding.version()), inputs, deadline);
      return extractor.extract(value, binding.pointer());
    }
  }

  private Object fetch(
      String id,
      SourceDefinition definition,
      Map<String, Object> inputs,
      ExecutionDeadline deadline) {
    Map<String, Object> values = normalizeInputs(definition, inputs);
    return deadline.within(
        () -> adapters.require(definition.kind()).fetch(id, definition, values, deadline));
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
