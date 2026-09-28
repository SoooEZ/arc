package dev.arc.engine;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * An entry- and weight-bounded cache in access order, for immutable values that a process may keep
 * between requests: compiled published plans and frozen source versions. Eviction drops the least
 * recently used entries once either bound is exceeded; a value heavier than the whole cache is
 * never stored. Every operation synchronizes on the cache.
 */
public final class BoundedCache<K, V> {
  private record Entry<V>(V value, long weight) {}

  private final int maximumEntries;
  private final long maximumWeight;
  private final Map<K, Entry<V>> entries = new LinkedHashMap<>(16, 0.75f, true);
  private long weight;

  public BoundedCache(int maximumEntries, long maximumWeight) {
    this.maximumEntries = maximumEntries;
    this.maximumWeight = maximumWeight;
  }

  /** The cached value, which becomes the most recently used, or null. */
  public synchronized V get(K key) {
    Entry<V> entry = entries.get(key);
    return entry == null ? null : entry.value();
  }

  /**
   * Stores the value under its weight, unless the cache holds nothing or the value alone exceeds
   * it.
   */
  public synchronized void put(K key, V value, long valueWeight) {
    if (maximumEntries <= 0 || valueWeight > maximumWeight) return;
    Entry<V> previous = entries.put(key, new Entry<>(value, valueWeight));
    weight += valueWeight - (previous == null ? 0 : previous.weight());
    while (entries.size() > maximumEntries || weight > maximumWeight) {
      var iterator = entries.entrySet().iterator();
      weight -= iterator.next().getValue().weight();
      iterator.remove();
    }
  }

  /** Drops every entry whose key matches, e.g. the versions of a deleted rule. */
  public synchronized void removeIf(Predicate<? super K> keys) {
    var iterator = entries.entrySet().iterator();
    while (iterator.hasNext()) {
      var entry = iterator.next();
      if (!keys.test(entry.getKey())) continue;
      weight -= entry.getValue().weight();
      iterator.remove();
    }
  }

  public synchronized int size() {
    return entries.size();
  }

  public synchronized long weight() {
    return weight;
  }
}
