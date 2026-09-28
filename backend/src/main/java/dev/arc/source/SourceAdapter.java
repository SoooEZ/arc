package dev.arc.source;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.model.SourceDefinition;
import java.util.Map;
import java.util.Set;

/** Add a Spring component implementing this port to support another source kind. */
public interface SourceAdapter {
  String kind();

  /**
   * The optional configuration fields this kind reads. {@link SourceValidator} rejects a definition
   * that sets any other before {@link #validate}, so a provider never stores what it would ignore.
   */
  Set<SourceDefinition.Field> fields();

  /** The plural noun messages call this kind, such as "HTTP sources" or "Lookup tables". */
  default String noun() {
    return kind() + " sources";
  }

  /** Rejects an invalid configuration before it is stored, without performing IO. */
  void validate(SourceDefinition definition);

  /**
   * Reads the current value for inputs that are already typed and defaulted, in parameter order.
   * The deadline belongs to the whole rule execution (a source Test uses the default one): a
   * provider that blocks on IO must stop when it expires, as {@code HttpSource} does by cancelling
   * its request. The caller checks the deadline before and after this call.
   */
  Object fetch(
      String sourceId,
      SourceDefinition definition,
      Map<String, Object> inputs,
      ExecutionDeadline deadline);
}
