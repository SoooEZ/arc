package dev.arc.engine;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class BoundedCacheTest {
  @Test
  void evictsTheLeastRecentlyUsedPastEitherBoundAndNeverStoresAnOversizedValue() {
    var cache = new BoundedCache<String, String>(3, 100);
    cache.put("a", "A", 30);
    cache.put("b", "B", 30);
    cache.put("c", "C", 30);
    assertThat(cache.get("a")).isEqualTo("A"); // a is now the most recently used
    cache.put("d", "D", 30); // past the weight bound: b goes
    assertThat(cache.get("b")).isNull();
    assertThat(cache.get("a")).isEqualTo("A");
    assertThat(cache.size()).isEqualTo(3);
    assertThat(cache.weight()).isEqualTo(90);
    cache.put("e", "E", 10); // past the entry bound: c, the least recently used, goes
    assertThat(cache.get("c")).isNull();
    assertThat(cache.size()).isEqualTo(3);
    cache.put("huge", "H", 101);
    assertThat(cache.get("huge")).isNull();
    cache.put("a", "A2", 50); // replacing keeps one entry and its new weight
    assertThat(cache.get("a")).isEqualTo("A2");
    assertThat(cache.weight()).isEqualTo(10 + 30 + 50);
  }

  @Test
  void removeIfDropsMatchingKeysAndTheirWeight() {
    var cache = new BoundedCache<String, Integer>(10, 1000);
    cache.put("rule:1", 1, 10);
    cache.put("rule:2", 2, 20);
    cache.put("other:1", 3, 5);
    cache.removeIf(key -> key.startsWith("rule:"));
    assertThat(cache.get("rule:1")).isNull();
    assertThat(cache.get("rule:2")).isNull();
    assertThat(cache.get("other:1")).isEqualTo(3);
    assertThat(cache.weight()).isEqualTo(5);
    assertThat(new BoundedCache<String, Integer>(0, 1000).size()).isZero();
  }
}
