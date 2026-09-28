package dev.arc.engine.execution;

import dev.arc.error.ArcException;
import java.util.*;

/**
 * Variables visible to a node. Each value remembers its producing node and the write that producer
 * replaced on the path that actually ran, so joins distinguish sequential updates from independent
 * writes. Scopes are immutable: a node that stores no result shares its single parent's scope.
 */
final class ExecutionScope {
  /** A variable's value, its producing node and the write that producer replaced (null if none). */
  private record Write(Object value, String producer, Write replaced) {
    /** Whether this write was computed with {@code earlier} in scope, possibly through updates. */
    boolean supersedes(Write earlier) {
      for (Write seen = replaced; seen != null; seen = seen.replaced())
        if (seen.producer().equals(earlier.producer())) return true;
      return false;
    }
  }

  private final Map<String, Write> writes;
  private final Map<String, Object> variables = new Variables();

  private ExecutionScope(Map<String, Write> writes) {
    this.writes = writes;
  }

  static ExecutionScope inputs(Map<String, Object> inputs, String inputNode) {
    var writes = new LinkedHashMap<String, Write>();
    inputs.forEach((name, value) -> writes.put(name, new Write(value, inputNode, null)));
    return new ExecutionScope(writes);
  }

  /**
   * The scope of a node reached through {@code parents}, its active incoming paths. A join keeps a
   * value only when it superseded every other candidate for that name on the path that ran. Writes
   * whose only link runs through a skipped branch are independent, so they conflict.
   */
  static ExecutionScope join(List<ExecutionScope> parents) {
    if (parents.size() == 1) return parents.getFirst();
    var joined = new ExecutionScope(new LinkedHashMap<>());
    for (ExecutionScope parent : parents) parent.writes.forEach(joined::keepLatest);
    return joined;
  }

  /** Keeps whichever write superseded the other; independent writes of one name conflict. */
  private void keepLatest(String name, Write candidate) {
    Write current = writes.putIfAbsent(name, candidate);
    if (current == null
        || candidate.producer().equals(current.producer())
        || current.supersedes(candidate)) return;
    if (!candidate.supersedes(current))
      throw ArcException.invalid(
          "Conflicting upstream values for '"
              + name
              + "'; use distinct result variable names before merging");
    writes.put(name, candidate);
  }

  /** A copy with {@code producer}'s result; the parent scope stays shared by its other children. */
  ExecutionScope withResult(String name, Object value, String producer) {
    var next = new LinkedHashMap<>(writes);
    next.put(name, new Write(value, producer, writes.get(name)));
    return new ExecutionScope(next);
  }

  /** A read-only view for expression evaluation; running a node does not copy its scope. */
  Map<String, Object> variables() {
    return variables;
  }

  private final class Variables extends AbstractMap<String, Object> {
    @Override
    public boolean containsKey(Object name) {
      return writes.containsKey(name);
    }

    @Override
    public Object get(Object name) {
      Write write = writes.get(name);
      return write == null ? null : write.value();
    }

    @Override
    public int size() {
      return writes.size();
    }

    @Override
    public Set<Entry<String, Object>> entrySet() {
      return new AbstractSet<>() {
        @Override
        public int size() {
          return writes.size();
        }

        @Override
        public Iterator<Entry<String, Object>> iterator() {
          return writes.entrySet().stream()
              .<Entry<String, Object>>map(
                  entry -> new SimpleImmutableEntry<>(entry.getKey(), entry.getValue().value()))
              .iterator();
        }
      };
    }
  }
}
