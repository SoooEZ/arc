package dev.arc.engine;

import dev.arc.model.Definition;
import java.util.HashMap;
import java.util.Map;

/** Request-scoped decorator: pins are fetched once; drafts are never cached. */
public final class MemoizingRuleResolver implements RuleResolver {
  private record Key(String id, int version) {}

  private final RuleResolver delegate;
  private final Map<Key, Definition> cache = new HashMap<>();

  public MemoizingRuleResolver(RuleResolver delegate) {
    this.delegate = delegate;
  }

  @Override
  public Definition resolve(String id, int version) {
    return cache.computeIfAbsent(new Key(id, version), key -> delegate.resolve(id, version));
  }
}
