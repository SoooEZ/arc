package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.rule.RuleRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcRuleRepository implements RuleRepository {
  private static final String CATALOG_FILTER =
      " WHERE (? = '' OR strpos(lower(id || ' ' || name || ' ' || description), lower(?)) > 0)"
          + " AND (? = '' OR kind = ?) AND (NOT ? OR published_version IS NOT NULL)";

  /**
   * Chooses the page's IDs before reading drafts. PostgreSQL would otherwise compute the JSONB
   * counts for every matching rule before sorting, although only one page is returned.
   */
  private static final String CATALOG_PAGE =
      """
      WITH page AS (
        SELECT id FROM rules %s
        ORDER BY updated_at DESC, id
        LIMIT ? OFFSET ?)
      SELECT r.id, r.name, r.description, r.kind, r.revision, r.published_version,
        r.created_at, r.updated_at,
        jsonb_array_length(r.draft->'nodes') AS node_count,
        jsonb_array_length(r.draft->'inputs') AS input_count,
        jsonb_array_length(
          jsonb_path_query_array(r.draft, '$.nodes[*] ? (@.type == "REFERENCE")')) AS reference_count
      FROM page JOIN rules r ON r.id = page.id
      ORDER BY r.updated_at DESC, r.id
      """
          .formatted(CATALOG_FILTER);

  private static final String VERSION_FILTER =
      " WHERE rule_id = ? AND (? = '' OR strpos(version::text, ?) > 0)";

  private static final RowMapper<RuleSummary> SUMMARY_MAPPER =
      (row, index) ->
          new RuleSummary(
              row.getString("id"),
              row.getString("name"),
              row.getString("description"),
              row.getString("kind"),
              row.getInt("revision"),
              row.getObject("published_version", Integer.class),
              instant(row, "created_at"),
              instant(row, "updated_at"),
              row.getInt("node_count"),
              row.getInt("input_count"),
              row.getInt("reference_count"));

  private static final RowMapper<RuleVersionSummary> VERSION_SUMMARY_MAPPER =
      (row, index) ->
          new RuleVersionSummary(
              row.getString("rule_id"), row.getInt("version"), instant(row, "published_at"));

  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final RowMapper<Rule> ruleMapper;
  private final RowMapper<RuleVersion> versionMapper;

  public JdbcRuleRepository(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
    this.ruleMapper =
        (row, index) ->
            new Rule(
                row.getString("id"),
                row.getString("name"),
                row.getString("description"),
                row.getString("kind"),
                decode(row.getString("draft")),
                row.getInt("revision"),
                row.getObject("published_version", Integer.class),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    this.versionMapper =
        (row, index) ->
            new RuleVersion(
                row.getString("rule_id"),
                row.getInt("version"),
                decode(row.getString("definition")),
                instant(row, "published_at"));
  }

  @Override
  public List<Rule> list() {
    return jdbc.query("SELECT * FROM rules ORDER BY updated_at DESC, id", ruleMapper);
  }

  @Override
  public boolean hasRules() {
    return Boolean.TRUE.equals(
        jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM rules)", Boolean.class));
  }

  @Override
  public CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly) {
    String search = page.search();
    return CatalogPages.read(
        jdbc,
        "SELECT count(*) FROM rules" + CATALOG_FILTER,
        CATALOG_PAGE,
        SUMMARY_MAPPER,
        page.offset(),
        page.limit(),
        search,
        search,
        kind,
        kind,
        publishedOnly);
  }

  @Override
  public CatalogPage<RuleVersionSummary> versionSummaries(String id, PageRequest page) {
    requireRule(id);
    String search = page.search();
    return CatalogPages.read(
        jdbc,
        "SELECT count(*) FROM rule_versions" + VERSION_FILTER,
        "SELECT rule_id, version, published_at FROM rule_versions"
            + VERSION_FILTER
            + " ORDER BY version DESC LIMIT ? OFFSET ?",
        VERSION_SUMMARY_MAPPER,
        page.offset(),
        page.limit(),
        id,
        search,
        search);
  }

  @Override
  public Rule get(String id) {
    return find(id, false);
  }

  @Override
  public Integer publishedVersion(String id) {
    var rows =
        jdbc.query(
            "SELECT published_version FROM rules WHERE id = ?",
            (row, index) -> row.getObject("published_version", Integer.class),
            id);
    if (rows.isEmpty()) throw notFound(id);
    return rows.getFirst();
  }

  @Override
  public Rule lock(String id) {
    return find(id, true);
  }

  private Rule find(String id, boolean lock) {
    var rows =
        jdbc.query(
            "SELECT * FROM rules WHERE id = ?" + (lock ? " FOR UPDATE" : ""), ruleMapper, id);
    if (rows.isEmpty()) throw notFound(id);
    return rows.getFirst();
  }

  private void requireRule(String id) {
    boolean exists =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM rules WHERE id = ?)", Boolean.class, id));
    if (!exists) throw notFound(id);
  }

  private static ArcException notFound(String id) {
    return new ArcException(404, "Rule not found: " + id);
  }

  @Override
  public Rule create(
      String id, String name, String description, String kind, Definition definition) {
    StoredText.requireStorable(name, description);
    try {
      jdbc.update(
          "INSERT INTO rules (id, name, description, kind, draft) VALUES (?, ?, ?, ?, ?::jsonb)",
          id,
          name,
          description,
          kind,
          encode(definition));
    } catch (DuplicateKeyException duplicate) {
      throw new ArcException(409, "This rule ID already exists");
    }
    return get(id);
  }

  @Override
  public Rule update(String id, String name, String description, Definition definition) {
    StoredText.requireStorable(name, description);
    jdbc.update(
        "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, revision = revision + 1, updated_at = now() WHERE id = ?",
        name,
        description,
        encode(definition),
        id);
    return get(id);
  }

  @Override
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

  @Override
  public List<RuleVersion> versions(String id) {
    requireRule(id);
    return jdbc.query(
        "SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version DESC", versionMapper, id);
  }

  @Override
  public RuleVersion version(String id, int version) {
    var rows =
        jdbc.query(
            "SELECT * FROM rule_versions WHERE rule_id = ? AND version = ?",
            versionMapper,
            id,
            version);
    if (rows.isEmpty())
      throw new ArcException(404, "Published rule version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  @Override
  public Definition resolveFormula(String id, int version) {
    var rows =
        jdbc.query(
            "SELECT r.kind, v.definition FROM rule_versions v JOIN rules r ON r.id = v.rule_id WHERE v.rule_id = ? AND v.version = ?",
            (row, index) -> {
              if (!"FORMULA".equals(row.getString("kind")))
                throw ArcException.invalid("@ calls require a published Formula: " + id);
              return decode(row.getString("definition"));
            },
            id,
            version);
    if (rows.isEmpty())
      throw new ArcException(404, "Published Formula version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  private static Instant instant(ResultSet row, String column) throws SQLException {
    return row.getTimestamp(column).toInstant();
  }

  private String encode(Definition d) {
    return json.encode(d);
  }

  private Definition decode(String value) {
    return json.decode(value, Definition.class);
  }
}
