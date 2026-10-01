package dev.arc.source;

import dev.arc.engine.BoundedCache;
import dev.arc.model.DataSource;
import dev.arc.model.SourceDefinition;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Frozen pinned source versions kept between requests, for execution reads and static checks alike.
 * A version is immutable and a source is never deleted, so a cached copy stays right for the life
 * of the process; the bounds keep large lookup tables from filling the heap, and a missing version
 * is never stored.
 */
@Component
public class SourceVersions {
  private record Version(String id, int version) {}

  private final SourceRepository repository;
  private final BoundedCache<Version, DataSource> versions =
      new BoundedCache<>(256, 16L * 1024 * 1024);

  public SourceVersions(SourceRepository repository) {
    this.repository = repository;
  }

  /**
   * The frozen copy of a version: from the cache, else read once and frozen. Readers receive an
   * unmodifiable copy, so no read can change what later reads see. An unknown version is a 404.
   */
  public DataSource get(String id, int version) {
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
}
