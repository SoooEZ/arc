package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import dev.arc.model.PageRequest;
import dev.arc.rule.RuleCatalog.CallingRule;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/** The rule read model's statements: catalog pages, summaries and the callers of a rule. */
class JdbcRuleCatalogTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final JdbcRuleCatalog catalog =
      new JdbcRuleCatalog(jdbc, new JsonCodec(new ObjectMapper()));

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

    catalog.catalog(new PageRequest(40, 10, " tax "), "RULE", true);

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

    catalog.catalog(new PageRequest(0, 10, ""), "", false);
    assertThatThrownBy(() -> catalog.summary("tax"))
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

    catalog.catalog(new PageRequest(0, 10, "tax rate"), "", false);
    int rules = statements.size();
    new JdbcSourceRepository(jdbc, new JsonCodec(new ObjectMapper()))
        .catalog(new PageRequest(0, 10, "tax rate"));

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

    catalog.catalog(new PageRequest(20, 10, "tax"), "FORMULA", true);
    new JdbcSourceRepository(jdbc, new JsonCodec(new ObjectMapper()))
        .catalog(new PageRequest(20, 10, "tax"));

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
   * A page of callers comes from the stored callee sets alone, like a deletion's caller scan: the
   * page statement reads no draft or definition, binds one argument per placeholder, and counts
   * each calling rule once whether its draft, its latest version or earlier versions call.
   */
  @Test
  void aPageOfCallingRulesReadsOnlyTheCalleeSets() throws Exception {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return 21L;
            });
    var row = mock(ResultSet.class);
    when(row.getString("id")).thenReturn("checkout");
    when(row.getString("name")).thenReturn("Checkout");
    when(row.getObject("published_version", Integer.class)).thenReturn(3);
    when(row.getBoolean("draft_calls")).thenReturn(true);
    when(row.getBoolean("latest_calls")).thenReturn(false);
    when(row.getInt("earlier_versions")).thenReturn(2);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of(call.<RowMapper<Object>>getArgument(1).mapRow(row, 0));
            });

    var page = catalog.callingRules("rates", new PageRequest(20, 10, ""));

    assertThat(page.total()).isEqualTo(21);
    assertThat(page.offset()).isEqualTo(20);
    assertThat(page.limit()).isEqualTo(10);
    assertThat(page.items())
        .containsExactly(new CallingRule("checkout", "Checkout", 3, true, false, 2));
    assertThat(statements).hasSize(2);
    for (int index = 0; index < statements.size(); index++)
      assertThat(placeholders(statements.get(index)))
          .as(statements.get(index))
          .isEqualTo(arguments.get(index).size());
    assertThat(statements.getFirst()).startsWith("SELECT count(*) FROM (").contains("UNION");
    assertThat(statements.getLast())
        .contains(
            "WHERE id <> ? AND callees @> ARRAY[?::text]",
            "WHERE rule_id <> ? AND callees @> ARRAY[?::text]",
            "ORDER BY rule_id LIMIT ? OFFSET ?",
            "earlier.version < r.published_version")
        .doesNotContain("r.draft", "v.definition", "SELECT *");
    assertThat(arguments.getFirst()).containsExactly("rates", "rates", "rates", "rates");
    assertThat(arguments.getLast())
        .containsExactly("rates", "rates", "rates", "rates", 10, 20, "rates", "rates", "rates");
  }

  @Test
  void callingRulesOfAMissingRuleIsNotFound() {
    when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class)))
        .thenReturn(false);
    assertThatThrownBy(() -> catalog.callingRules("gone", new PageRequest(0, 20, "")))
        .hasMessage("Rule not found: gone");
    verify(jdbc, never()).query(anyString(), any(RowMapper.class), any(Object[].class));
  }

  /**
   * A caller's draft or version is read only while its stored callee set still names the rule, so a
   * draft saved without the call since the page was read yields nothing rather than a stale pin.
   */
  @Test
  void aCallingDefinitionIsReadOnlyWhileItsCalleeSetNamesTheRule() throws Exception {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    String stored =
        "{\"schemaVersion\":1,\"inputs\":[],\"nodes\":[{\"id\":\"tax\",\"type\":\"REFERENCE\","
            + "\"label\":\"Tax\",\"ruleId\":\"rates\",\"version\":2}],\"edges\":[]}";
    var row = mock(ResultSet.class);
    when(row.getString("draft")).thenReturn(stored);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              if (statements.size() > 1) return List.of();
              return List.of(call.<RowMapper<Object>>getArgument(1).mapRow(row, 0));
            });

    var draft = catalog.callingDefinition("checkout", null, "rates");
    var version = catalog.callingDefinition("checkout", 3, "rates");

    assertThat(draft).isPresent();
    assertThat(draft.get().nodes().getFirst().version()).isEqualTo(2);
    assertThat(version).isEmpty();
    assertThat(statements)
        .containsExactly(
            "SELECT draft FROM rules WHERE id = ? AND callees @> ARRAY[?::text]",
            "SELECT definition FROM rule_versions WHERE rule_id = ? AND version = ? AND callees @>"
                + " ARRAY[?::text]");
    assertThat(arguments)
        .containsExactly(List.of("checkout", "rates"), List.of("checkout", 3, "rates"));
  }
}
