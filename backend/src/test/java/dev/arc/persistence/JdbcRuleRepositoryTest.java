package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import dev.arc.model.PageRequest;
import dev.arc.model.RuleKind;
import dev.arc.rule.RuleSamples;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
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
    assertThat(arguments.getFirst()).containsExactly("tax", "tax", "RULE", "RULE", true, 10, 40);
  }

  /**
   * A search matches within one field. The fields joined by spaces matched across a boundary: "tax
   * rate" found the rule tax named "Rate table", and "country tax" the source country-tax.
   * PostgreSQL itself runs in scripts/smoke.py; here every catalog statement lists its fields.
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
        .noneMatch(statement -> statement.contains("|| ' ' ||"));
    assertThat(statements.subList(0, rules))
        .allMatch(statement -> statement.contains("unnest(ARRAY[id, name, description])"));
    assertThat(statements.subList(rules, statements.size()))
        .allMatch(statement -> statement.contains("unnest(ARRAY[s.id, s.name])"));
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
    repository.update("a", "A", "", null);
    verify(jdbc)
        .query(
            eq(
                "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, revision ="
                    + " nextval('rule_revisions'), updated_at = now() WHERE id = ? RETURNING *"),
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
    assertThat(repository.update("a", "A", "", null)).isSameAs(stored);
    assertThat(repository.create("a", "A", "", "RULE", null)).isSameAs(stored);
    assertThat(repository.publish(stored)).isSameAs(stored);

    assertThat(statements).hasSize(4).noneMatch(statement -> statement.startsWith("SELECT *"));
    assertThat(statements.subList(1, 4)).allMatch(statement -> statement.endsWith(" RETURNING *"));
    verify(jdbc)
        .update(
            eq("INSERT INTO rule_versions (rule_id, version, definition) VALUES (?, ?, ?::jsonb)"),
            any(Object[].class));
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
    var definition = RuleSamples.blank(RuleKind.FORMULA);
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
   * Searching the bare ID matched every stored definition for IDs such as "type", so a delete
   * decoded them all under the row lock; the filter now names the two ways a rule is called.
   */
  @Test
  void definitionsMentioningFiltersOnReferencePinsAndFormulaCalls() {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of();
            });

    repository.definitionsMentioning("type");

    String statement = statements.getFirst();
    assertThat(statement).doesNotContain("strpos(draft::text, ?)");
    assertThat(statement)
        .contains(
            "draft @> jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object('ruleId', ?::text)))",
            "strpos(draft::text, '@' || ? || ':') > 0",
            "definition @> jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object('ruleId', ?::text)))",
            "strpos(definition::text, '@' || ? || ':') > 0");
    assertThat(arguments.getFirst())
        .containsExactly("type", "type", "type", "type", "type", "type");
  }
}
