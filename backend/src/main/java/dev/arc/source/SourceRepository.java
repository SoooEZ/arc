package dev.arc.source;

import dev.arc.model.*;
import java.util.List;

/**
 * Versioned source storage; writes participate in the caller's transaction. Every read of an
 * unknown source, whichever version it names, is a 404 "Source not found".
 */
public interface SourceRepository {
  List<DataSource> list();

  CatalogPage<SourceSummary> catalog(int offset, int limit, String search);

  CatalogPage<SourceVersionSummary> versionSummaries(String id, int offset, int limit);

  DataSource get(String id, int version);

  /** Current version selected by the source's persisted version pointer, or a 404 error. */
  DataSource latest(String id);

  List<DataSource> versions(String id);

  DataSource create(String id, String name, SourceDefinition definition);

  /**
   * Locks the source row for the current transaction, against other writers, and returns its
   * current version; an unknown source is a 404 "Source not found". {@link SourceService} checks
   * the revision and validates the configuration between this lock and {@link #appendVersion}.
   */
  int lock(String id);

  /**
   * Stores version {@code currentVersion + 1} and moves the source's pointer and name to it, inside
   * the caller's transaction after {@link #lock}; it performs no revision or configuration check.
   */
  DataSource appendVersion(String id, String name, int currentVersion, SourceDefinition definition);
}
