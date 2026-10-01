package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.source.SourceRepository;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcSourceRepository implements SourceRepository {
  /** A search matches within the ID or the name, ignoring case, like a rule search. */
  private static final String CATALOG_FILTER =
      " WHERE (? = '' OR EXISTS (SELECT 1 FROM unnest(ARRAY[s.id, s.name]) AS field"
          + " WHERE strpos(lower(field), lower(?)) > 0))";

  /** Chooses the page first, so only the returned sources read their current configuration. */
  private static final String CATALOG_PAGE =
      """
      WITH page AS (
        SELECT s.id FROM data_sources s %s
        ORDER BY s.updated_at DESC, s.id
        LIMIT ? OFFSET ?)
      SELECT s.id, s.name, s.version, v.definition->>'kind' AS kind
      FROM page
      JOIN data_sources s ON s.id = page.id
      JOIN data_source_versions v ON v.source_id = s.id AND v.version = s.version
      ORDER BY s.updated_at DESC, s.id
      """
          .formatted(CATALOG_FILTER);

  private static final RowMapper<SourceSummary> SUMMARY_MAPPER =
      (row, index) ->
          new SourceSummary(
              row.getString("id"),
              row.getString("name"),
              row.getInt("version"),
              row.getString("kind"));

  private static final RowMapper<SourceVersionSummary> VERSION_SUMMARY_MAPPER =
      (row, index) ->
          new SourceVersionSummary(
              row.getString("source_id"),
              row.getInt("version"),
              row.getTimestamp("created_at").toInstant());

  private final JdbcTemplate db;
  private final JsonCodec json;
  private final RowMapper<DataSource> mapper;

  public JdbcSourceRepository(JdbcTemplate db, JsonCodec json) {
    this.db = db;
    this.json = json;
    this.mapper =
        (row, index) ->
            new DataSource(
                row.getString("id"),
                row.getString("name"),
                row.getInt("version"),
                json.decode(row.getString("definition"), SourceDefinition.class));
  }

  @Override
  public List<DataSource> list() {
    return db.query(
        """
        SELECT s.id, s.name, v.version, v.definition
        FROM data_sources s
        JOIN data_source_versions v ON v.source_id = s.id AND v.version = s.version
        ORDER BY s.updated_at DESC
        """,
        mapper);
  }

  @Override
  public CatalogPage<SourceSummary> catalog(int offset, int limit, String search) {
    return CatalogPages.read(
        db,
        "SELECT count(*) FROM data_sources s" + CATALOG_FILTER,
        CATALOG_PAGE,
        SUMMARY_MAPPER,
        offset,
        limit,
        search,
        search);
  }

  @Override
  public CatalogPage<SourceVersionSummary> versionSummaries(String id, int offset, int limit) {
    requireSource(id);
    return CatalogPages.read(
        db,
        "SELECT count(*) FROM data_source_versions WHERE source_id = ?",
        "SELECT source_id, version, created_at FROM data_source_versions WHERE source_id = ?"
            + " ORDER BY version DESC LIMIT ? OFFSET ?",
        VERSION_SUMMARY_MAPPER,
        offset,
        limit,
        id);
  }

  /**
   * An unknown source is the same 404 on every read path; only a known one has missing versions.
   */
  @Override
  public DataSource get(String id, int version) {
    var rows =
        db.query(
            """
            SELECT s.id, s.name, v.version, v.definition
            FROM data_sources s
            JOIN data_source_versions v ON v.source_id = s.id
            WHERE s.id = ? AND v.version = ?
            """,
            mapper,
            id,
            version);
    if (rows.isEmpty()) {
      requireSource(id);
      throw new ArcException(404, "Data source version not found: " + id + " v" + version);
    }
    return rows.getFirst();
  }

  @Override
  public DataSource latest(String id) {
    var rows =
        db.query(
            """
        SELECT s.id, s.name, v.version, v.definition
        FROM data_sources s
        JOIN data_source_versions v ON v.source_id = s.id AND v.version = s.version
        WHERE s.id = ?
        """,
            mapper,
            id);
    if (rows.isEmpty()) throw sourceNotFound();
    return rows.getFirst();
  }

  /** Newest first; an unknown source is a 404 like its other version reads. */
  @Override
  public List<DataSource> versions(String id) {
    requireSource(id);
    return db.query(
        """
        SELECT s.id, s.name, v.version, v.definition
        FROM data_sources s
        JOIN data_source_versions v ON v.source_id = s.id
        WHERE s.id = ?
        ORDER BY v.version DESC
        """,
        mapper,
        id);
  }

  /** An ID that is already stored, including by a concurrent create, is a 409 conflict. */
  @Override
  public DataSource create(String id, String name, SourceDefinition definition) {
    StoredText.requireStorable(name);
    String encoded = json.encode(definition);
    try {
      db.update("INSERT INTO data_sources(id,name) VALUES (?,?)", id, name);
    } catch (DuplicateKeyException duplicate) {
      throw new ArcException(409, "This source ID already exists");
    }
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,1,?::jsonb)",
        id,
        encoded);
    return get(id, 1);
  }

  @Override
  public int lock(String id) {
    var versions =
        db.queryForList(
            "SELECT version FROM data_sources WHERE id=? FOR UPDATE", Integer.class, id);
    if (versions.isEmpty()) throw sourceNotFound();
    return versions.getFirst();
  }

  @Override
  public DataSource appendVersion(
      String id, String name, int currentVersion, SourceDefinition definition) {
    StoredText.requireStorable(name);
    int nextVersion = currentVersion + 1;
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,?,?::jsonb)",
        id,
        nextVersion,
        json.encode(definition));
    db.update(
        "UPDATE data_sources SET name=?,version=?,updated_at=now() WHERE id=?",
        name,
        nextVersion,
        id);
    return get(id, nextVersion);
  }

  private void requireSource(String id) {
    boolean exists =
        Boolean.TRUE.equals(
            db.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM data_sources WHERE id = ?)", Boolean.class, id));
    if (!exists) throw sourceNotFound();
  }

  private static ArcException sourceNotFound() {
    return new ArcException(404, "Source not found");
  }
}
