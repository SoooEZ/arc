package dev.arc.persistence;

import static dev.arc.persistence.Rows.instant;
import static dev.arc.persistence.RuleRows.ruleNotFound;

import dev.arc.model.*;
import dev.arc.rule.RuleCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * The rule read model in SQL: catalog pages and summaries that count a draft's parts without
 * returning it, version histories, and the callers of a rule read from the stored callee sets
 * (migration V5). No statement here locks; {@link JdbcRuleRepository} owns the locks and writes.
 */
@Repository
public class JdbcRuleCatalog implements RuleCatalog {
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
          jsonb_path_query_array(r.draft, '$.nodes[*] ? (@.type == "%s")')) AS reference_count,
        COALESCE(r.published_version IS NOT NULL AND r.draft <> v.definition, false)
          AS draft_changed
      """
          .formatted(NodeKind.REFERENCE.name());

  /**
   * The latest published version beside its rule, for {@code draft_changed}: the publication copied
   * the draft as stored, so the two stay equal until the draft is saved with a change.
   */
  private static final String LATEST_VERSION =
      "LEFT JOIN rule_versions v ON v.rule_id = r.id AND v.version = r.published_version";

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
      FROM page JOIN rules r ON r.id = page.id %s
      ORDER BY r.updated_at DESC, r.id
      """
          .formatted(CATALOG_FILTER, SUMMARY_COLUMNS, LATEST_VERSION);

  /** One rule's catalog item, as a catalog page writes it. */
  private static final String SUMMARY =
      "SELECT %s FROM rules r %s WHERE r.id = ?".formatted(SUMMARY_COLUMNS, LATEST_VERSION);

  private static final String VERSION_FILTER =
      " WHERE rule_id = ? AND (? = '' OR strpos(version::text, ?) > 0)";

  /** Each other rule once whose draft or a published version calls the rule, as in CALLERS. */
  private static final String CALLING_RULES =
      """
      SELECT id AS rule_id FROM rules
      WHERE id <> ? AND callees @> ARRAY[?::text]
      UNION
      SELECT rule_id FROM rule_versions
      WHERE rule_id <> ? AND callees @> ARRAY[?::text]
      """;

  /**
   * A page of {@link #CALLING_RULES} with what the callee sets tell of each: whether the draft and
   * the latest published version call the rule, and how many earlier versions do. Only callee sets
   * are read; the definitions are read one at a time afterwards, for their pins.
   */
  private static final String CALLING_PAGE =
      """
      WITH page AS (
        %s
        ORDER BY rule_id LIMIT ? OFFSET ?)
      SELECT r.id, r.name, r.published_version,
        r.callees @> ARRAY[?::text] AS draft_calls,
        COALESCE(v.callees @> ARRAY[?::text], false) AS latest_calls,
        (SELECT count(*) FROM rule_versions earlier
          WHERE earlier.rule_id = r.id AND earlier.version < r.published_version
            AND earlier.callees @> ARRAY[?::text]) AS earlier_versions
      FROM page JOIN rules r ON r.id = page.rule_id
      LEFT JOIN rule_versions v ON v.rule_id = r.id AND v.version = r.published_version
      ORDER BY r.id
      """
          .formatted(CALLING_RULES);

  private static final RowMapper<CallingRule> CALLING_RULE_MAPPER =
      (row, index) ->
          new CallingRule(
              row.getString("id"),
              row.getString("name"),
              row.getObject("published_version", Integer.class),
              row.getBoolean("draft_calls"),
              row.getBoolean("latest_calls"),
              row.getInt("earlier_versions"));

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
              row.getInt("reference_count"),
              row.getBoolean("draft_changed"));

  private static final RowMapper<RuleVersionSummary> VERSION_SUMMARY_MAPPER =
      (row, index) ->
          new RuleVersionSummary(
              row.getString("rule_id"),
              row.getInt("version"),
              instant(row, "published_at"),
              row.getString("note"));

  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final RowMapper<Rule> rules;

  public JdbcRuleCatalog(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
    this.rules = RuleRows.mapper(json);
  }

  @Override
  public List<Rule> list() {
    return jdbc.query("SELECT * FROM rules ORDER BY updated_at DESC, id", rules);
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
    RuleRows.requireRule(jdbc, id);
    String search = page.search();
    return CatalogPages.read(
        jdbc,
        "SELECT count(*) FROM rule_versions" + VERSION_FILTER,
        "SELECT rule_id, version, published_at, note FROM rule_versions"
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
    if (rows.isEmpty()) throw ruleNotFound(id);
    return rows.getFirst();
  }

  @Override
  public CatalogPage<CallingRule> callingRules(String id, PageRequest page) {
    RuleRows.requireRule(jdbc, id);
    Object[] calling = {id, id, id, id};
    return CatalogPages.read(
        jdbc,
        "SELECT count(*) FROM (" + CALLING_RULES + ") calling",
        CALLING_PAGE,
        CALLING_RULE_MAPPER,
        page.offset(),
        page.limit(),
        calling,
        id,
        id,
        id);
  }

  @Override
  public Optional<Definition> callingDefinition(String callerId, Integer version, String id) {
    List<String> rows;
    if (version == null)
      rows =
          jdbc.query(
              "SELECT draft FROM rules WHERE id = ? AND callees @> ARRAY[?::text]",
              (row, index) -> row.getString("draft"),
              callerId,
              id);
    else
      rows =
          jdbc.query(
              "SELECT definition FROM rule_versions"
                  + " WHERE rule_id = ? AND version = ? AND callees @> ARRAY[?::text]",
              (row, index) -> row.getString("definition"),
              callerId,
              version,
              id);
    return rows.isEmpty()
        ? Optional.empty()
        : Optional.of(json.decode(rows.getFirst(), Definition.class));
  }
}
