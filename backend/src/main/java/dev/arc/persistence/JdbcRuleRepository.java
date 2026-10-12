package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.rule.RuleRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcRuleRepository implements RuleRepository {
  /** A search within the ID, the name or the description, a kind, and published rules only. */
  private static final String[] SEARCHED = {"id", "name", "description"};

  private static final String CATALOG_FILTER =
      " WHERE "
          + CatalogPages.searchWithin(SEARCHED)
          + " AND (? = '' OR kind = ?) AND (NOT ? OR published_version IS NOT NULL)";

  /**
   * The columns of a {@link RuleSummary}: a rule's metadata and the counts read from its draft,
   * never the draft itself. The counted node type is spelled by {@link NodeKind}, the one
   * vocabulary of node types.
   */
  private static final String SUMMARY_COLUMNS =
      """
      r.id, r.name, r.description, r.kind, r.revision, r.published_version,
        r.created_at, r.updated_at,
        jsonb_array_length(r.draft->'nodes') AS node_count,
        jsonb_array_length(r.draft->'inputs') AS input_count,
        jsonb_array_length(
          jsonb_path_query_array(r.draft, '$.nodes[*] ? (@.type == "%s")')) AS reference_count
      """
          .formatted(NodeKind.REFERENCE.name());

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
      SELECT %s
      FROM page JOIN rules r ON r.id = page.id
      ORDER BY r.updated_at DESC, r.id
      """
          .formatted(CATALOG_FILTER, SUMMARY_COLUMNS);

  /** One rule's catalog item, as a catalog page writes it. */
  private static final String SUMMARY =
      "SELECT %s FROM rules r WHERE r.id = ?".formatted(SUMMARY_COLUMNS);

  private static final String VERSION_FILTER =
      " WHERE rule_id = ? AND (? = '' OR strpos(version::text, ?) > 0)";

  /**
   * The drafts and versions whose stored callee set names the rule, through the GIN indexes of the
   * {@code callees} columns (migration V5). Each write stores the exact set it holds against
   * deletion, so no definition is read or decoded here: the prefilter before this, a JSONB
   * containment OR-ed with a text search of every stored definition, scanned and serialised both
   * tables under the rule's lock (14.5 s for 2 GB of stored JSON), while saves of its callers and
   * every other writer of the rule waited.
   */
  private static final String CALLERS =
      """
      SELECT id AS rule_id, NULL::integer AS version FROM rules
      WHERE id <> ? AND callees @> ARRAY[?::text]
      UNION ALL
      SELECT rule_id, version FROM rule_versions
      WHERE rule_id <> ? AND callees @> ARRAY[?::text]
      ORDER BY rule_id, version NULLS FIRST
      """;

  private static final RowMapper<Caller> CALLER_MAPPER =
      (row, index) -> new Caller(row.getString("rule_id"), row.getObject("version", Integer.class));

  /**
   * The columns of a {@link Rule} without its draft, for a write that leaves the draft as it is.
   */
  private static final String METADATA_COLUMNS =
      "id, name, description, kind, revision, published_version, created_at, updated_at";

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

  /** The marker row is inserted once; a later claim changes no row and returns false. */
  @Override
  public boolean claimSampleSeeding() {
    return jdbc.update(
            "INSERT INTO workspace_seeds (name) VALUES ('rule-samples') ON CONFLICT DO NOTHING")
        == 1;
  }

  @Override
  public CatalogPage<RuleSummary> catalog(PageRequest page, String kind, boolean publishedOnly) {
    var arguments = new ArrayList<>(CatalogPages.searchArguments(page.search(), SEARCHED));
    arguments.addAll(List.of(kind, kind, publishedOnly));
    return CatalogPages.read(
        jdbc,
        "SELECT count(*) FROM rules" + CATALOG_FILTER,
        CATALOG_PAGE,
        SUMMARY_MAPPER,
        page.offset(),
        page.limit(),
        arguments.toArray());
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
  public RuleSummary summary(String id) {
    var rows = jdbc.query(SUMMARY, SUMMARY_MAPPER, id);
    if (rows.isEmpty()) throw notFound(id);
    return rows.getFirst();
  }

  @Override
  public Rule get(String id) {
    return find(id, "");
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

  /**
   * Compatible with the KEY SHARE locks that callers hold, so drafts pinning each other never
   * deadlock.
   */
  @Override
  public int lockForSave(String id) {
    return lockedRevision(id, " FOR NO KEY UPDATE");
  }

  @Override
  public Rule lockForPublication(String id) {
    return find(id, " FOR NO KEY UPDATE");
  }

  /**
   * Conflicts with every lock, including the KEY SHARE locks of a caller being saved or published.
   */
  @Override
  public int lockForDeletion(String id) {
    return lockedRevision(id, " FOR UPDATE");
  }

  /** The revision of a locked rule; its draft, which may be large, is not read. */
  private int lockedRevision(String id, String lock) {
    var rows =
        jdbc.query(
            "SELECT revision FROM rules WHERE id = ?" + lock,
            (row, index) -> row.getInt("revision"),
            id);
    if (rows.isEmpty()) throw notFound(id);
    return rows.getFirst();
  }

  /**
   * The IDs travel as one array parameter: a draft may call more rules than a statement may have
   * parameters (65,535), and a placeholder per callee failed such a save with a 500.
   */
  @Override
  public void lockCallees(Collection<String> ruleIds) {
    if (ruleIds.isEmpty()) return;
    jdbc.query(
        "SELECT id FROM rules WHERE id = ANY (?) ORDER BY id FOR KEY SHARE",
        statement ->
            statement.setArray(
                1, statement.getConnection().createArrayOf("text", ruleIds.toArray())),
        (row, index) -> row.getString("id"));
  }

  private Rule find(String id, String lock) {
    var rows = jdbc.query("SELECT * FROM rules WHERE id = ?" + lock, ruleMapper, id);
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
    return ArcException.notFound("Rule not found: " + id);
  }

  @Override
  public Rule create(
      String id,
      String name,
      String description,
      String kind,
      Definition definition,
      Set<String> callees) {
    StoredText.requireStorable(name, description);
    try {
      return written(
          id,
          "INSERT INTO rules (id, name, description, kind, draft, callees) VALUES (?, ?, ?, ?, ?::jsonb, ?) RETURNING *",
          id,
          name,
          description,
          kind,
          json.encodeEditable(definition),
          textArray(callees));
    } catch (DuplicateKeyException duplicate) {
      throw ArcException.conflict("This rule ID already exists");
    }
  }

  @Override
  public Rule update(
      String id, String name, String description, Definition definition, Set<String> callees) {
    StoredText.requireStorable(name, description);
    return written(
        id,
        "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, callees = ?, revision = nextval('rule_revisions'), updated_at = now() WHERE id = ? RETURNING *",
        name,
        description,
        json.encodeEditable(definition),
        textArray(callees),
        id);
  }

  /**
   * The version copies the stored draft column in SQL, so the draft text crosses JDBC once, for the
   * locked read: encoding the decoded draft again (with a second scan for unstorable text) and
   * decoding it a third time from the row the update returned moved it three times under the lock.
   * A stored draft is JSON that passed its save, so the copy stores the same JSONB; a draft saved
   * under an older record shape is copied as stored, where it was normalised through the current
   * records before. Neither path applies the editable-size limit, which belongs to saves.
   */
  @Override
  public Rule publish(Rule rule, Set<String> callees) {
    int version = rule.publishedVersion() == null ? 1 : rule.publishedVersion() + 1;
    int inserted =
        jdbc.update(
            "INSERT INTO rule_versions (rule_id, version, definition, callees) SELECT id, ?, draft, ? FROM rules WHERE id = ?",
            version,
            textArray(callees),
            rule.id());
    if (inserted == 0) throw notFound(rule.id());
    RowMapper<Rule> withLockedDraft =
        (row, index) ->
            new Rule(
                row.getString("id"),
                row.getString("name"),
                row.getString("description"),
                row.getString("kind"),
                rule.draft(),
                row.getInt("revision"),
                row.getObject("published_version", Integer.class),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    var rows =
        jdbc.query(
            "UPDATE rules SET published_version = ?, callees = ?, revision = nextval('rule_revisions'), updated_at = now() WHERE id = ? RETURNING "
                + METADATA_COLUMNS,
            withLockedDraft,
            version,
            textArray(callees),
            rule.id());
    if (rows.isEmpty()) throw notFound(rule.id());
    return rows.getFirst();
  }

  /** A {@code text[]} parameter, which the driver binds from a Java array. */
  private static String[] textArray(Set<String> values) {
    return values.toArray(String[]::new);
  }

  /**
   * The row a write returns, as stored: the response carries the draft PostgreSQL holds (JSONB
   * orders object keys its own way), without a second statement to read it back.
   */
  private Rule written(String id, String statement, Object... arguments) {
    var rows = jdbc.query(statement, ruleMapper, arguments);
    if (rows.isEmpty()) throw notFound(id);
    return rows.getFirst();
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
      throw ArcException.notFound("Published rule version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  @Override
  public List<Caller> callersOf(String id) {
    return jdbc.query(CALLERS, CALLER_MAPPER, id, id, id, id);
  }

  @Override
  public void delete(String id) {
    jdbc.update("DELETE FROM rule_versions WHERE rule_id = ?", id);
    jdbc.update("DELETE FROM rules WHERE id = ?", id);
  }

  @Override
  public KindedVersion versionWithKind(String id, int version) {
    var rows =
        jdbc.query(
            "SELECT r.kind, v.definition FROM rule_versions v JOIN rules r ON r.id = v.rule_id WHERE v.rule_id = ? AND v.version = ?",
            (row, index) ->
                new KindedVersion(row.getString("kind"), decode(row.getString("definition"))),
            id,
            version);
    if (rows.isEmpty())
      throw ArcException.notFound("Published Formula version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  private static Instant instant(ResultSet row, String column) throws SQLException {
    return row.getTimestamp(column).toInstant();
  }

  private Definition decode(String value) {
    return json.decode(value, Definition.class);
  }
}
