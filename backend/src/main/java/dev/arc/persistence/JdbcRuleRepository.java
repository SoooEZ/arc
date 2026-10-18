package dev.arc.persistence;

import static dev.arc.persistence.Rows.instant;
import static dev.arc.persistence.RuleRows.ruleNotFound;

import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.rule.RuleRepository;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Rules and their versions as the commands and the resolver need them: the locks, the writes, the
 * reads made under them, and the callers a deletion must find. The read model, catalog pages,
 * summaries and the callers page, is {@link JdbcRuleCatalog}.
 */
@Repository
public class JdbcRuleRepository implements RuleRepository {
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

  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final RowMapper<Rule> ruleMapper;
  private final RowMapper<RuleVersion> versionMapper;

  public JdbcRuleRepository(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
    this.ruleMapper = RuleRows.mapper(json);
    this.versionMapper =
        (row, index) ->
            new RuleVersion(
                row.getString("rule_id"),
                row.getInt("version"),
                decode(row.getString("definition")),
                instant(row, "published_at"));
  }

  /** The marker row is inserted once; a later claim changes no row and returns false. */
  @Override
  public boolean claimSampleSeeding() {
    return jdbc.update(
            "INSERT INTO workspace_seeds (name) VALUES ('rule-samples') ON CONFLICT DO NOTHING")
        == 1;
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
    if (rows.isEmpty()) throw ruleNotFound(id);
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
   * KEY SHARE, as the callers of a rule hold it: deletion's FOR UPDATE waits for the copy, while a
   * save's or a publication's NO KEY UPDATE does not.
   */
  @Override
  public Rule lockForCopy(String id) {
    return find(id, " FOR KEY SHARE");
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
    if (rows.isEmpty()) throw ruleNotFound(id);
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
    if (rows.isEmpty()) throw ruleNotFound(id);
    return rows.getFirst();
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
  public Rule publish(Rule rule, Set<String> callees, String note) {
    StoredText.requireStorable(note);
    int version = rule.publishedVersion() == null ? 1 : rule.publishedVersion() + 1;
    int inserted =
        jdbc.update(
            "INSERT INTO rule_versions (rule_id, version, definition, callees, note) SELECT id, ?, draft, ?, ? FROM rules WHERE id = ?",
            version,
            textArray(callees),
            note,
            rule.id());
    if (inserted == 0) throw ruleNotFound(rule.id());
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
    if (rows.isEmpty()) throw ruleNotFound(rule.id());
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
    if (rows.isEmpty()) throw ruleNotFound(id);
    return rows.getFirst();
  }

  @Override
  public List<RuleVersion> versions(String id) {
    RuleRows.requireRule(jdbc, id);
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

  private Definition decode(String value) {
    return json.decode(value, Definition.class);
  }
}
