package dev.arc.source;

import dev.arc.model.*;
import java.util.List;

/** Versioned source storage; writes participate in the caller's transaction. */
public interface SourceRepository {
  List<DataSource> list();

  CatalogPage<SourceSummary> catalog(int offset, int limit, String search);

  CatalogPage<SourceVersionSummary> versionSummaries(String id, int offset, int limit);

  DataSource get(String id, int version);

  /** Current version selected by the source's persisted version pointer, or a 404 error. */
  DataSource latest(String id);

  List<DataSource> versions(String id);

  DataSource create(String id, String name, SourceDefinition definition);

  DataSource update(String id, String name, int revision, SourceDefinition definition);
}
