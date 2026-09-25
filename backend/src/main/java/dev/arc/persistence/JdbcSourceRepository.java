package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.source.SourceRepository;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcSourceRepository implements SourceRepository {
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
    String filter = " WHERE (? = '' OR strpos(lower(s.id || ' ' || s.name), lower(?)) > 0)";
    Long total =
        db.queryForObject(
            "SELECT count(*) FROM data_sources s" + filter, Long.class, search, search);
    var items =
        db.query(
            """
        SELECT s.id, s.name, s.version, v.definition->>'kind' AS kind
        FROM data_sources s JOIN data_source_versions v ON v.source_id = s.id AND v.version = s.version
        """
                + filter
                + " ORDER BY s.updated_at DESC, s.id LIMIT ? OFFSET ?",
            (rs, index) ->
                new SourceSummary(
                    rs.getString("id"),
                    rs.getString("name"),
                    rs.getInt("version"),
                    rs.getString("kind")),
            search,
            search,
            limit,
            offset);
    return new CatalogPage<>(items, total, offset, limit);
  }

  @Override
  public CatalogPage<SourceVersionSummary> versionSummaries(String id, int offset, int limit) {
    var exists =
        db.queryForObject("SELECT count(*) FROM data_sources WHERE id = ?", Long.class, id);
    if (exists == 0) throw new ArcException(404, "Source not found");
    Long total =
        db.queryForObject(
            "SELECT count(*) FROM data_source_versions WHERE source_id = ?", Long.class, id);
    var items =
        db.query(
            "SELECT source_id, version, created_at FROM data_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT ? OFFSET ?",
            (rs, index) ->
                new SourceVersionSummary(
                    rs.getString("source_id"),
                    rs.getInt("version"),
                    rs.getTimestamp("created_at").toInstant()),
            id,
            limit,
            offset);
    return new CatalogPage<>(items, total, offset, limit);
  }

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
    if (rows.isEmpty())
      throw new ArcException(404, "Data source version not found: " + id + " v" + version);
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
    if (rows.isEmpty()) throw new ArcException(404, "Source not found");
    return rows.getFirst();
  }

  @Override
  public List<DataSource> versions(String id) {
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

  @Override
  public DataSource create(String id, String name, SourceDefinition definition) {
    db.update("INSERT INTO data_sources(id,name) VALUES (?,?)", id, name);
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,1,?::jsonb)",
        id,
        json.encode(definition));
    return get(id, 1);
  }

  @Override
  public DataSource update(String id, String name, int revision, SourceDefinition definition) {
    var versions =
        db.queryForList(
            "SELECT version FROM data_sources WHERE id=? FOR UPDATE", Integer.class, id);
    if (versions.isEmpty()) throw new ArcException(404, "Data source not found");
    if (versions.getFirst() != revision)
      throw new ArcException(409, "Source changed in another editor; reload before saving");
    int nextVersion = revision + 1;
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
}
