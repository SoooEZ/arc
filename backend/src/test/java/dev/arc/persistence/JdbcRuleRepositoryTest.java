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
import dev.arc.model.PageRequest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
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
   * Writers of a rule exclude each other but not the callers holding it (KEY SHARE), so drafts that
   * pin each other cannot deadlock; only a deletion (FOR UPDATE) waits for those callers.
   */
  @Test
  void locksDistinguishWritersCallersAndDeletion() {
    var statements = new ArrayList<String>();
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of();
            });
    assertThatThrownBy(() -> repository.lock("a")).hasMessage("Rule not found: a");
    assertThatThrownBy(() -> repository.lockForDeletion("a")).hasMessage("Rule not found: a");
    repository.lockCallees(List.of("b", "a"));
    repository.lockCallees(List.of());
    assertThat(statements)
        .containsExactly(
            "SELECT * FROM rules WHERE id = ? FOR NO KEY UPDATE",
            "SELECT * FROM rules WHERE id = ? FOR UPDATE",
            "SELECT id FROM rules WHERE id IN (?, ?) ORDER BY id FOR KEY SHARE");
  }

  /** Revisions come from one sequence, so a re-created rule never repeats a deleted one's. */
  @Test
  void writesTakeTheNextRevisionFromTheSharedSequence() {
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenReturn(List.of(mock(dev.arc.model.Rule.class)));
    repository.update("a", "A", "", null);
    verify(jdbc)
        .update(
            eq(
                "UPDATE rules SET name = ?, description = ?, draft = ?::jsonb, revision ="
                    + " nextval('rule_revisions'), updated_at = now() WHERE id = ?"),
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
