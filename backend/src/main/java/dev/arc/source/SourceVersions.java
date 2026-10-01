package dev.arc.source;

import dev.arc.engine.BoundedCache;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Frozen pinned source configurations kept between requests, for execution reads and static checks
 * alike. A version is immutable and a source is never deleted, so a cached copy stays right for the
 * life of the process; the bounds keep large lookup tables from filling the heap, and a missing
 * version is never stored. Only the configuration is kept: a source's name is the name of its
 * current version, which a rename changes.
 */
@Component
public class SourceVersions {
  private record Version(String id, int version) {}

  private final SourceRepository repository;
  private final BoundedCache<Version, SourceDefinition> versions =
      new BoundedCache<>(256, 16L * 1024 * 1024);

  public SourceVersions(SourceRepository repository) {
    this.repository = repository;
  }

  /**
   * The frozen configuration of a version: from the cache, else read once and frozen. Readers
   * receive an unmodifiable copy, so no read can change what later reads see. An unknown version is
   * a 404.
   */
  public SourceDefinition get(String id, int version) {
    var key = new Version(id, version);
    SourceDefinition cached = versions.get(key);
    if (cached != null) return cached;
    SourceDefinition frozen = repository.get(id, version).definition().detached();
    versions.put(key, frozen, weightOf(frozen));
    return frozen;
  }

  /**
   * An estimate of the heap a configuration retains, in bytes: its parameters with their defaults,
   * URL, headers and lookup entries. Each value counts its object and what it holds, so a 100-digit
   * decimal weighs its BigInteger and digits; every number counted 16 units, and tables of long
   * decimals held several times the bound.
   */
  private static long weightOf(SourceDefinition definition) {
    long weight = 256;
    for (Input parameter : definition.parameters())
      weight += 48 + weightOf(parameter.name()) + weightOf(parameter.defaultValue());
    return weight
        + weightOf(definition.url())
        + weightOf(definition.entries())
        + weightOf(definition.secretHeaders());
  }

  private static long weightOf(Object value) {
    return switch (value) {
      case null -> 8;
      case String text -> 40 + 2L * text.length();
      // A decimal of more than 18 digits keeps them in a BigInteger.
      case BigDecimal decimal -> 40 + (decimal.precision() > 18 ? 48 + decimal.precision() / 2 : 0);
      case BigInteger integer -> 48 + integer.bitLength() / 8;
      case Number number -> 24;
      case Map<?, ?> map -> {
        long weight = 64;
        for (var entry : map.entrySet())
          weight += 48 + weightOf(entry.getKey()) + weightOf(entry.getValue());
        yield weight;
      }
      case Iterable<?> items -> {
        long weight = 40;
        for (Object item : items) weight += 8 + weightOf(item);
        yield weight;
      }
      default -> 16;
    };
  }
}
