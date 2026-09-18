package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.source.SourceRepository;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcSourceRepository implements SourceRepository {
  private final JdbcTemplate db;
  private final JsonCodec json;

  public JdbcSourceRepository(JdbcTemplate db, JsonCodec json) {
    this.db = db;
    this.json = json;
  }

  public List<DataSource> list() {
    return db.query(
        "SELECT s.*,v.definition FROM data_sources s JOIN data_source_versions v ON"
            + " v.source_id=s.id AND v.version=s.version ORDER BY s.updated_at DESC",
        (r, i) ->
            new DataSource(
                r.getString("id"),
                r.getString("name"),
                r.getInt("version"),
                decode(r.getString("definition"))));
  }

  public DataSource get(String id, int version) {
    var rows =
        db.query(
            "SELECT s.id,s.name,v.version,v.definition FROM data_sources s JOIN"
                + " data_source_versions v ON v.source_id=s.id WHERE s.id=? AND v.version=?",
            (r, i) ->
                new DataSource(
                    r.getString("id"),
                    r.getString("name"),
                    r.getInt("version"),
                    decode(r.getString("definition"))),
            id,
            version);
    if (rows.isEmpty())
      throw new ArcException(404, "Data source version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  public List<DataSource> versions(String id) {
    return db.query(
        "SELECT s.id,s.name,v.version,v.definition FROM data_sources s JOIN data_source_versions v"
            + " ON v.source_id=s.id WHERE s.id=? ORDER BY v.version DESC",
        (r, i) ->
            new DataSource(
                r.getString("id"),
                r.getString("name"),
                r.getInt("version"),
                decode(r.getString("definition"))),
        id);
  }

  public DataSource create(String id, String name, SourceDefinition definition) {
    db.update("INSERT INTO data_sources(id,name) VALUES (?,?)", id, name);
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,1,?::jsonb)",
        id,
        encode(definition));
    return get(id, 1);
  }

  public DataSource update(String id, String name, int revision, SourceDefinition definition) {
    var versions =
        db.queryForList(
            "SELECT version FROM data_sources WHERE id=? FOR UPDATE", Integer.class, id);
    if (versions.isEmpty()) throw new ArcException(404, "Data source not found");
    if (versions.getFirst() != revision)
      throw new ArcException(409, "Source changed in another editor; reload before saving");
    int v = revision + 1;
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,?,?::jsonb)",
        id,
        v,
        encode(definition));
    db.update("UPDATE data_sources SET name=?,version=?,updated_at=now() WHERE id=?", name, v, id);
    return get(id, v);
  }

  private String encode(SourceDefinition definition) {
    return json.encode(definition);
  }

  private SourceDefinition decode(String value) {
    return json.decode(value, SourceDefinition.class);
  }
}
