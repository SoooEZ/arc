package dev.arc.source;

import dev.arc.model.DataSource;
import dev.arc.model.SourceDefinition;
import java.util.List;

/** Versioned source storage; writes participate in the caller's transaction. */
public interface SourceRepository {
  List<DataSource> list();

  DataSource get(String id, int version);

  List<DataSource> versions(String id);

  DataSource create(String id, String name, SourceDefinition definition);

  DataSource update(String id, String name, int revision, SourceDefinition definition);
}
