package dev.arc.source;

import dev.arc.engine.BoundedCache;
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
  private final SourceAdapters adapters;
  private final JsonPointerExtractor extractor;

  /**
   * Frozen pinned versions kept between requests. A version is immutable and a source is never
   * deleted, so a cached copy stays right for the life of the process; the bounds keep large lookup
   * tables from filling the heap, and a missing version is never stored. Each request still
   * snapshots one configuration per version in its {@link Session}.
   */
  private final BoundedCache<Version, DataSource> versions =
      new BoundedCache<>(256, 16L * 1024 * 1024);

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
    private final Map<Version, DataSource> configurations = new HashMap<>();

    private Session() {}

    public SourceDefinition definition(String id, int version) {
      return source(id, version).definition();
    }

    /** One stored configuration per request, shared by static validation and every read. */
    private DataSource source(String id, int version) {
      return configurations.computeIfAbsent(new Version(id, version), ignored -> load(id, version));
    }

    /**
     * The frozen copy of a version: from the process cache, else read once and frozen. Providers
     * receive an unmodifiable copy, so no read can change what later reads see.
     */
    private DataSource load(String id, int version) {
      var key = new Version(id, version);
      DataSource cached = versions.get(key);
      if (cached != null) return cached;
      DataSource source = repository.get(id, version);
      DataSource frozen =
          new DataSource(
              source.id(), source.name(), source.version(), source.definition().detached());
      versions.put(key, frozen, weightOf(frozen));
      return frozen;
    }

    @Override
    public Object read(
        SourceBinding binding, Map<String, Object> inputs, ExecutionDeadline deadline) {
      deadline.check();
      Object value = fetch(source(binding.id(), binding.version()), inputs, deadline);
      return extractor.extract(value, binding.pointer());
    }
  }

  /** An estimate of a version's retained size: its entries, headers, URL and parameters. */
  private static long weightOf(DataSource source) {
    SourceDefinition definition = source.definition();
    long weight = 256L + definition.parameters().size() * 128L;
    if (definition.url() != null) weight += definition.url().length() * 2L;
    return weight + weightOf(definition.entries()) + weightOf(definition.secretHeaders());
  }

  private static long weightOf(Object value) {
    if (value == null) return 8;
    if (value instanceof String text) return 16L + text.length() * 2L;
    if (value instanceof Map<?, ?> map) {
      long weight = 32;
      for (var entry : map.entrySet())
        weight += weightOf(entry.getKey()) + weightOf(entry.getValue());
      return weight;
    }
    if (value instanceof Iterable<?> items) {
      long weight = 32;
      for (Object item : items) weight += weightOf(item);
      return weight;
    }
    return 16;
  }

  private Object fetch(DataSource source, Map<String, Object> inputs, ExecutionDeadline deadline) {
    SourceDefinition definition = source.definition();
    Map<String, Object> values = normalizeInputs(definition, inputs);
    return deadline.within(
        () -> adapters.require(definition.kind()).fetch(source.id(), definition, values, deadline));
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
