package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.rule.RuleRepository;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcRuleRepository implements RuleRepository {
  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final RowMapper<Rule> mapper;

  public JdbcRuleRepository(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
    this.mapper =
        (rs, i) ->
            new Rule(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("kind"),
                decode(rs.getString("draft")),
                rs.getInt("revision"),
                rs.getObject("published_version", Integer.class),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
  }

  public List<Rule> list() {
    return jdbc.query("SELECT * FROM rules ORDER BY updated_at DESC, id", mapper);
  }

  public CatalogPage<RuleSummary> catalog(
      int offset, int limit, String search, String kind, boolean publishedOnly) {
    String filter =
        " WHERE (? = '' OR strpos(lower(id || ' ' || name || ' ' || description), lower(?)) > 0)"
            + " AND (? = '' OR kind = ?) AND (NOT ? OR published_version IS NOT NULL)";
    Long total =
        jdbc.queryForObject(
            "SELECT count(*) FROM rules" + filter,
            Long.class,
            search,
            search,
            kind,
            kind,
            publishedOnly);
    var items =
        jdbc.query(
            """
        SELECT id, name, description, kind, revision, published_version, created_at, updated_at,
          jsonb_array_length(draft->'nodes') AS node_count,
          jsonb_array_length(draft->'inputs') AS input_count,
          jsonb_array_length(jsonb_path_query_array(draft, '$.nodes[*] ? (@.type == "REFERENCE")')) AS reference_count
        FROM rules
        """
                + filter
                + " ORDER BY updated_at DESC, id LIMIT ? OFFSET ?",
            (rs, index) ->
                new RuleSummary(
                    rs.getString("id"),
                    rs.getString("name"),
                    rs.getString("description"),
                    rs.getString("kind"),
                    rs.getInt("revision"),
                    rs.getObject("published_version", Integer.class),
                    rs.getTimestamp("created_at").toInstant(),
                    rs.getTimestamp("updated_at").toInstant(),
                    rs.getInt("node_count"),
                    rs.getInt("input_count"),
                    rs.getInt("reference_count")),
            search,
            search,
            kind,
            kind,
            publishedOnly,
            limit,
            offset);
    return new CatalogPage<>(items, total, offset, limit);
  }

  public CatalogPage<RuleVersionSummary> versionSummaries(String id, int offset, int limit) {
    publishedVersion(id);
    Long total =
        jdbc.queryForObject("SELECT count(*) FROM rule_versions WHERE rule_id = ?", Long.class, id);
    var items =
        jdbc.query(
            "SELECT rule_id, version, published_at FROM rule_versions WHERE rule_id = ? ORDER BY version DESC LIMIT ? OFFSET ?",
            (rs, index) ->
                new RuleVersionSummary(
                    rs.getString("rule_id"),
                    rs.getInt("version"),
                    rs.getTimestamp("published_at").toInstant()),
            id,
            limit,
            offset);
    return new CatalogPage<>(items, total, offset, limit);
  }

  public Rule get(String id) {
    return find(id, false);
  }

  public Integer publishedVersion(String id) {
    var rows =
        jdbc.query(
            "SELECT published_version FROM rules WHERE id = ?",
            (rs, index) -> rs.getObject("published_version", Integer.class),
            id);
    if (rows.isEmpty()) throw new ArcException(404, "Rule not found: " + id);
    return rows.getFirst();
  }

  public Rule lock(String id) {
    return find(id, true);
  }

  private Rule find(String id, boolean lock) {
    var rows =
        jdbc.query("SELECT * FROM rules WHERE id = ?" + (lock ? " FOR UPDATE" : ""), mapper, id);
    if (rows.isEmpty()) throw new ArcException(404, "Rule not found: " + id);
    return rows.getFirst();
  }

  public Rule create(
      String id, String name, String description, String kind, Definition definition) {
    jdbc.update(
        "INSERT INTO rules (id, name, description, kind, draft) VALUES (?, ?, ?, ?, ?::jsonb)",
        id,
        name,
        description,
        kind,
        encode(definition));
    return get(id);
  }

  public Rule update(String id, String name, String description, Definition definition) {
    jdbc.update(
        "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, revision = revision + 1, updated_at = now() WHERE id = ?",
        name,
        description,
        encode(definition),
        id);
    return get(id);
  }

  public Rule publish(Rule rule) {
    int version = rule.publishedVersion() == null ? 1 : rule.publishedVersion() + 1;
    jdbc.update(
        "INSERT INTO rule_versions (rule_id, version, definition) VALUES (?, ?, ?::jsonb)",
        rule.id(),
        version,
        encode(rule.draft()));
    jdbc.update(
        "UPDATE rules SET published_version = ?, revision = revision + 1, updated_at = now() WHERE id = ?",
        version,
        rule.id());
    return get(rule.id());
  }

  public List<RuleVersion> versions(String id) {
    get(id);
    return jdbc.query(
        "SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version DESC",
        (rs, i) ->
            new RuleVersion(
                rs.getString("rule_id"),
                rs.getInt("version"),
                decode(rs.getString("definition")),
                rs.getTimestamp("published_at").toInstant()),
        id);
  }

  public RuleVersion version(String id, int version) {
    var rows =
        jdbc.query(
            "SELECT * FROM rule_versions WHERE rule_id = ? AND version = ?",
            (rs, i) ->
                new RuleVersion(
                    rs.getString("rule_id"),
                    rs.getInt("version"),
                    decode(rs.getString("definition")),
                    rs.getTimestamp("published_at").toInstant()),
            id,
            version);
    if (rows.isEmpty())
      throw new ArcException(404, "Published rule version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  private String encode(Definition d) {
    return json.encode(d);
  }

  private Definition decode(String value) {
    return json.decode(value, Definition.class);
  }
}
