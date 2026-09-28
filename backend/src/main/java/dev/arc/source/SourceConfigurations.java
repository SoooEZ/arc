package dev.arc.source;

import dev.arc.model.SourceDefinition;

/**
 * Where a static check reads pinned source configurations: the stored versions, memoized for one
 * check, or an execution's request session, which shares each snapshot with the runtime reads.
 * Implementations never fetch provider values.
 */
@FunctionalInterface
public interface SourceConfigurations {
  /** The configuration of one immutable version; an unknown pin is a 404. */
  SourceDefinition get(String id, int version);
}
