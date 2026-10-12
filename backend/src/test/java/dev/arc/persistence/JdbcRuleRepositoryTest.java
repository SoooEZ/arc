package dev.arc.persistence;

import static dev.arc.support.GraphFixtures.calculation;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.StreamWriteFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.PageRequest;
import dev.arc.rule.RuleRepository.Caller;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

class JdbcRuleRepositoryTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final JdbcRuleRepository repository =
      new JdbcRuleRepository(jdbc, new JsonCodec(new ObjectMapper()));

  /**
   * A draft is stored as responses write it, every number in plain decimals. Twenty inputs of a
   * thousand "1e100" each fit a 140 KB save but grew to 2 MB stored, which the editor sends back on
   * its next save: the request limit refused every save after (413). Publishing copies a draft that
   * was saved, so it is not refused.
   */
  @Test
  void aDraftTooLargeToSaveBackOnceItsNumbersAreWrittenOutIsRefused() {
    var plainNumbers =
        new JdbcRuleRepository(
            jdbc,
            new JsonCodec(
                JsonMapper.builder().enable(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN).build()));
    var inputs = new ArrayList<Input>();
    for (int index = 0; index < 20; index++)
      inputs.add(
          new Input(
              "a" + index, "ARRAY", false, Collections.nCopies(1_000, new BigDecimal("1E+100"))));
    var definition = new Definition(1, inputs, List.of(), List.of());
    String tooLarge =
        "Definition exceeds 960 KiB once its numbers are written out in full, more than a save"
            + " can send back";
    assertThatThrownBy(() -> plainNumbers.create("big", "Big", "", "FORMULA", definition, Set.of()))
        .hasMessage(tooLarge);
    assertThatThrownBy(() -> plainNumbers.update("big", "Big", "", definition, Set.of()))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(422))
        .hasMessage(tooLarge);
    verifyNoInteractions(jdbc);
    // Nine such inputs fit: the save reaches its UPDATE, which this mock answers with no row.
    var fitting = new Definition(1, inputs.subList(0, 9), List.of(), List.of());
    assertThatThrownBy(() -> plainNumbers.update("big", "Big", "", fitting, Set.of()))
        .hasMessage("Rule not found: big");
  }

  /**
   * PostgreSQL computes select-list JSONB functions for every matching row before a sort unless the
   * page is chosen first, so a catalog page must not cost work proportional to all drafts.
   */
  @Test
  void draftCountsAreReadOnlyForTheChosenPage() {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of();
            });

    repository.catalog(new PageRequest(40, 10, " tax "), "RULE", true);

    String page = statements.getFirst();
    assertThat(page.indexOf("LIMIT ? OFFSET ?"))
        .as("the page is chosen before drafts are read")
        .isPositive()
        .isLessThan(page.indexOf("jsonb_array_length"));
    assertThat(arguments.getFirst())
        .containsExactly("tax", "tax", "tax", "tax", "RULE", "RULE", true, 10, 40);
  }

  /**
   * The summary of one rule is the item a catalog page writes for it: the same columns, read for
   * that rule alone and never the draft itself, so a client that needs a rule's current name or
   * incarnation does not download its graph.
   */
  @Test
  void aSummaryReadsTheCatalogColumnsOfOneRuleWithoutItsDraft() {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of();
            });

    repository.catalog(new PageRequest(0, 10, ""), "", false);
    assertThatThrownBy(() -> repository.summary("tax"))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Rule not found: tax");

    String page = statements.get(0);
    String summary = statements.get(1);
    assertThat(columns(summary)).isEqualTo(columns(page)).contains("reference_count");
    assertThat(selected(columns(summary))).doesNotContain("r.draft", "draft", "*", "r.*");
    assertThat(summary).endsWith("WHERE r.id = ?");
    assertThat(arguments.get(1)).containsExactly("tax");
  }

  /** The select list of a statement's last SELECT, up to its FROM. */
  private static String columns(String statement) {
    String select = statement.substring(statement.lastIndexOf("SELECT ") + "SELECT ".length());
    return select.substring(0, select.indexOf("FROM")).strip();
  }

  /** The items of a select list: the commas outside parentheses separate them. */
  private static List<String> selected(String columns) {
    var items = new ArrayList<String>();
    int depth = 0;
    int start = 0;
    for (int index = 0; index < columns.length(); index++) {
      char character = columns.charAt(index);
      if (character == '(') depth++;
      else if (character == ')') depth--;
      else if (character == ',' && depth == 0) {
        items.add(columns.substring(start, index).strip());
        start = index + 1;
      }
    }
    items.add(columns.substring(start).strip());
    return items;
  }

  /**
   * A search matches within one field. The fields joined by spaces matched across a boundary: "tax
   * rate" found the rule tax named "Rate table", and "country tax" the source country-tax.
   * PostgreSQL itself runs in scripts/smoke.py; here every catalog statement lists its fields, each
   * searched on its own, in plain conditions rather than a per-row subplan over an unnested array.
   */
  @Test
  void catalogSearchesMatchWithinOneField() {
    var statements = new ArrayList<String>();
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return 1L;
            });
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of();
            });

    repository.catalog(new PageRequest(0, 10, "tax rate"), "", false);
    int rules = statements.size();
    new JdbcSourceRepository(jdbc, new JsonCodec(new ObjectMapper())).catalog(0, 10, "tax rate");

    assertThat(statements)
        .hasSize(2 * rules)
        .noneMatch(statement -> statement.contains("|| ' ' ||"))
        .noneMatch(statement -> statement.contains("unnest"));
    assertThat(statements.subList(0, rules))
        .allMatch(
            statement ->
                statement.contains(
                    "(? = '' OR strpos(lower(id), lower(?)) > 0 OR strpos(lower(name), lower(?))"
                        + " > 0 OR strpos(lower(description), lower(?)) > 0)"));
    assertThat(statements.subList(rules, statements.size()))
        .allMatch(
            statement ->
                statement.contains(
                    "(? = '' OR strpos(lower(s.id), lower(?)) > 0 OR strpos(lower(s.name),"
                        + " lower(?)) > 0)"));
  }

  /**
   * The catalog filters are positional arguments bound to a hand-assembled WHERE clause, and only
   * the smoke test ran the statements against PostgreSQL: every executed catalog statement must
   * carry one placeholder per bound argument, with the search, kind and publishedOnly filters all
   * set. The JSONB path literal of the summary columns holds a '?' that is not a parameter.
   */
  @Test
  void catalogStatementsBindOneArgumentPerPlaceholder() {
    var executed = new LinkedHashMap<String, List<Object>>();
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              executed.put(call.getArgument(0), Arrays.asList(values).subList(2, values.length));
              return 0L;
            });
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              executed.put(call.getArgument(0), Arrays.asList(values).subList(2, values.length));
              return List.of();
            });

    repository.catalog(new PageRequest(20, 10, "tax"), "FORMULA", true);
    new JdbcSourceRepository(jdbc, new JsonCodec(new ObjectMapper())).catalog(20, 10, "tax");

    assertThat(executed).hasSize(4);
    executed.forEach(
        (statement, arguments) ->
            assertThat(placeholders(statement))
                .as(statement)
                .isEqualTo(arguments.size())
                .isGreaterThanOrEqualTo(3));
  }

  /** Placeholders outside single-quoted literals. */
  private static int placeholders(String statement) {
    int count = 0;
    boolean quoted = false;
    for (char character : statement.toCharArray()) {
      if (character == '\'') quoted = !quoted;
      else if (character == '?' && !quoted) count++;
    }
    return count;
  }

  /**
   * Writers of a rule exclude each other but not the callers holding it (KEY SHARE), so drafts that
   * pin each other cannot deadlock; only a deletion (FOR UPDATE) waits for those callers.
   */
  @Test
  void locksDistinguishWritersCallersAndDeletion() throws Exception {
    var statements = new ArrayList<String>();
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of();
            });
    when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of();
            });
    assertThatThrownBy(() -> repository.lockForSave("a")).hasMessage("Rule not found: a");
    assertThatThrownBy(() -> repository.lockForPublication("a")).hasMessage("Rule not found: a");
    assertThatThrownBy(() -> repository.lockForDeletion("a")).hasMessage("Rule not found: a");
    repository.lockCallees(List.of("b", "a"));
    repository.lockCallees(List.of());
    assertThat(statements)
        .containsExactly(
            "SELECT revision FROM rules WHERE id = ? FOR NO KEY UPDATE",
            "SELECT * FROM rules WHERE id = ? FOR NO KEY UPDATE",
            "SELECT revision FROM rules WHERE id = ? FOR UPDATE",
            "SELECT id FROM rules WHERE id = ANY (?) ORDER BY id FOR KEY SHARE");
  }

  /**
   * A draft may call more rules than one statement may have parameters (65,535 in PostgreSQL's
   * protocol), so the callee lock binds them as one array: a placeholder per callee was a 500.
   */
  @Test
  void calleesAreLockedThroughOneArrayParameter() throws Exception {
    var ids = IntStream.range(0, 70_000).mapToObj(index -> "r" + index).toList();
    var connection = mock(Connection.class);
    var statement = mock(PreparedStatement.class);
    var array = mock(java.sql.Array.class);
    when(statement.getConnection()).thenReturn(connection);
    when(connection.createArrayOf(eq("text"), any(Object[].class))).thenReturn(array);
    var statements = new ArrayList<String>();
    when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              call.<PreparedStatementSetter>getArgument(1).setValues(statement);
              return List.of();
            });

    repository.lockCallees(ids);

    assertThat(statements)
        .containsExactly("SELECT id FROM rules WHERE id = ANY (?) ORDER BY id FOR KEY SHARE");
    verify(connection).createArrayOf("text", ids.toArray());
    verify(statement).setArray(1, array);
  }

  /** Revisions come from one sequence, so a re-created rule never repeats a deleted one's. */
  @Test
  void writesTakeTheNextRevisionFromTheSharedSequence() {
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenReturn(List.of(mock(dev.arc.model.Rule.class)));
    repository.update("a", "A", "", null, Set.of());
    verify(jdbc)
        .query(
            eq(
                "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, callees = ?, revision"
                    + " = nextval('rule_revisions'), updated_at = now() WHERE id = ? RETURNING *"),
            any(RowMapper.class),
            any(Object[].class));
  }

  /**
   * A save reads its draft once, from the row its write returns. The lock decoded the stored draft
   * only to compare revisions, and a second statement read the row back after each write.
   */
  @Test
  void writesReturnTheirRowAndASaveLockReadsOnlyTheRevision() {
    var statements = new ArrayList<String>();
    var stored = mock(dev.arc.model.Rule.class);
    when(stored.id()).thenReturn("a");
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              String statement = call.getArgument(0);
              statements.add(statement);
              return statement.startsWith("SELECT revision") ? List.of(7) : List.of(stored);
            });

    assertThat(repository.lockForSave("a")).isEqualTo(7);
    assertThat(repository.update("a", "A", "", null, Set.of())).isSameAs(stored);
    assertThat(repository.create("a", "A", "", "RULE", null, Set.of())).isSameAs(stored);

    assertThat(statements).hasSize(3).noneMatch(statement -> statement.startsWith("SELECT *"));
    assertThat(statements.subList(1, 3)).allMatch(statement -> statement.endsWith(" RETURNING *"));
  }

  /**
   * A publication copies the stored draft column into the version in SQL and reads the row back
   * without its draft: the draft was decoded under the lock already, and it was encoded again,
   * scanned for unstorable text and decoded a third time from the updated row before.
   */
  @Test
  void publishCopiesTheStoredDraftInSqlAndReadsNoDraftBack() throws Exception {
    var draft = calculation();
    var locked =
        new dev.arc.model.Rule("a", "A", "", "FORMULA", draft, 7, 2, Instant.EPOCH, Instant.EPOCH);
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    var row = mock(ResultSet.class);
    when(row.getString("id")).thenReturn("a");
    when(row.getString("name")).thenReturn("A");
    when(row.getString("description")).thenReturn("");
    when(row.getString("kind")).thenReturn("FORMULA");
    when(row.getInt("revision")).thenReturn(9);
    when(row.getObject("published_version", Integer.class)).thenReturn(3);
    when(row.getTimestamp(anyString())).thenReturn(Timestamp.from(Instant.EPOCH));
    when(jdbc.update(anyString(), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              statements.add(call.getArgument(0));
              arguments.add(Arrays.asList(values).subList(1, values.length));
              return 1;
            });
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              statements.add(call.getArgument(0));
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of(call.<RowMapper<Object>>getArgument(1).mapRow(row, 0));
            });

    var published = repository.publish(locked, new LinkedHashSet<>(List.of("b", "a")));

    assertThat(statements)
        .containsExactly(
            "INSERT INTO rule_versions (rule_id, version, definition, callees) SELECT id, ?, draft,"
                + " ? FROM rules WHERE id = ?",
            "UPDATE rules SET published_version = ?, callees = ?, revision ="
                + " nextval('rule_revisions'), updated_at = now() WHERE id = ? RETURNING id, name,"
                + " description, kind, revision, published_version, created_at, updated_at");
    for (List<Object> bound : arguments) {
      assertThat(bound.get(0)).isEqualTo(3);
      assertThat((String[]) bound.get(1)).containsExactly("b", "a");
      assertThat(bound.get(2)).isEqualTo("a");
    }
    verify(row, never()).getString("draft");
    assertThat(published.draft()).isSameAs(draft);
    assertThat(published.revision()).isEqualTo(9);
    assertThat(published.publishedVersion()).isEqualTo(3);
    assertThat(published.createdAt()).isEqualTo(Instant.EPOCH);
  }

  /** Creates and saves store the rules the draft calls beside it, as one text array. */
  @Test
  void createsAndSavesStoreTheCalleeSetBesideTheDraft() {
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of(mock(dev.arc.model.Rule.class));
            });
    var callees = new LinkedHashSet<>(List.of("tax", "discount"));

    repository.create("a", "A", "", "RULE", calculation(), callees);
    repository.update("a", "A", "", calculation(), callees);

    assertThat((String[]) arguments.get(0).get(5)).containsExactly("tax", "discount");
    assertThat((String[]) arguments.get(1).get(3)).containsExactly("tax", "discount");
  }

  /** The seeding claim is one insert whose row count decides it. */
  @Test
  void sampleSeedingIsClaimedByInsertingItsMarkerOnce() {
    String claim =
        "INSERT INTO workspace_seeds (name) VALUES ('rule-samples') ON CONFLICT DO NOTHING";
    when(jdbc.update(claim)).thenReturn(1, 0);
    assertThat(repository.claimSampleSeeding()).isTrue();
    assertThat(repository.claimSampleSeeding()).isFalse();
  }

  /**
   * The row mapper returns the version with its rule's kind; the rule layer's default method
   * decides that only a published Formula is callable, and a missing version stays a 404.
   */
  @Test
  void formulaCallsResolveOnlyPublishedFormulasFromTheKindStorageReturns() {
    var definition = calculation();
    String encoded = new JsonCodec(new ObjectMapper()).encode(definition);
    var byKind = new HashMap<String, String>();
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              String kind = byKind.get(values[2]);
              if (kind == null) return List.of();
              RowMapper<Object> mapper = call.getArgument(1);
              ResultSet row = mock(ResultSet.class);
              when(row.getString("kind")).thenReturn(kind);
              when(row.getString("definition")).thenReturn(encoded);
              return List.of(mapper.mapRow(row, 0));
            });
    byKind.put("discount", "FORMULA");
    byKind.put("pricing", "DECISION_TREE");
    byKind.put("shipping", "RULE");

    assertThat(repository.resolveFormula("discount", 1)).isEqualTo(definition);
    for (String other : List.of("pricing", "shipping"))
      assertThatThrownBy(() -> repository.resolveFormula(other, 1))
          .as(other)
          .hasMessage("@ calls require a published Formula: " + other);
    assertThatThrownBy(() -> repository.resolveFormula("missing", 3))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(404);
              assertThat(error.getMessage())
                  .isEqualTo("Published Formula version not found: missing v3");
            });
  }

  /** Versions reference their rule, so they are removed before it. */
  @Test
  void deletingARuleRemovesItsVersionsFirst() {
    repository.delete("old-draft");
    var order = inOrder(jdbc);
    order.verify(jdbc).update("DELETE FROM rule_versions WHERE rule_id = ?", "old-draft");
    order.verify(jdbc).update("DELETE FROM rules WHERE id = ?", "old-draft");
  }

  /**
   * A deletion finds its callers in the stored callee sets, through their indexes: the scan before
   * it serialised every stored draft and version to text under the rule's lock (14.5 s for 2 GB),
   * while saves of the callers waited. No definition is read or decoded.
   */
  @Test
  void callersAreReadFromTheStoredCalleeSetsWithoutDecodingADefinition() throws Exception {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    var draftRow = mock(ResultSet.class);
    when(draftRow.getString("rule_id")).thenReturn("checkout");
    when(draftRow.getObject("version", Integer.class)).thenReturn(null);
    var versionRow = mock(ResultSet.class);
    when(versionRow.getString("rule_id")).thenReturn("checkout");
    when(versionRow.getObject("version", Integer.class)).thenReturn(3);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              RowMapper<Object> mapper = call.getArgument(1);
              return List.of(mapper.mapRow(draftRow, 0), mapper.mapRow(versionRow, 1));
            });

    var callers = repository.callersOf("type");

    String statement = statements.getFirst();
    assertThat(statement)
        .contains(
            "FROM rules\nWHERE id <> ? AND callees @> ARRAY[?::text]",
            "FROM rule_versions\nWHERE rule_id <> ? AND callees @> ARRAY[?::text]",
            "ORDER BY rule_id, version NULLS FIRST")
        .doesNotContain("strpos", "::text,", "draft AS", "definition");
    assertThat(arguments.getFirst()).containsExactly("type", "type", "type", "type");
    assertThat(callers).containsExactly(new Caller("checkout", null), new Caller("checkout", 3));
    assertThat(callers.getFirst().describe()).isEqualTo("checkout (draft)");
    assertThat(callers.getLast().describe()).isEqualTo("checkout v3");
    verify(draftRow, never()).getString("definition");
  }
}
