package dev.arc.persistence;

import static dev.arc.persistence.Rows.instant;
import static dev.arc.persistence.RuleRows.ruleNotFound;

import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import dev.arc.model.RuleTestCase;
import dev.arc.rule.RuleTestCaseRepository;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Test cases in {@code rule_test_cases} (migration V7). Inputs and an expected result are JSONB
 * written by the application's codec, so decimals keep their places (120.00 stays 120.00); an
 * expected failure stores SQL NULL as its result and the JSON null expects a null result.
 */
@Repository
public class JdbcRuleTestCaseRepository implements RuleTestCaseRepository {
  private static final String COLUMNS =
      "id, rule_id, name, inputs, expected_result, expected_error, created_at, updated_at";

  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final RowMapper<RuleTestCase> mapper;

  public JdbcRuleTestCaseRepository(JdbcTemplate jdbc, JsonCodec json) {
    this.jdbc = jdbc;
    this.json = json;
    this.mapper =
        (row, index) ->
            new RuleTestCase(
                row.getLong("id"),
                row.getString("rule_id"),
                row.getString("name"),
                inputs(row.getString("inputs")),
                expectedResult(row.getString("expected_result")),
                row.getString("expected_error"),
                instant(row, "created_at"),
                instant(row, "updated_at"));
  }

  @Override
  public List<RuleTestCase> list(String ruleId) {
    RuleRows.requireRule(jdbc, ruleId);
    return jdbc.query(
        "SELECT " + COLUMNS + " FROM rule_test_cases WHERE rule_id = ? ORDER BY id",
        mapper,
        ruleId);
  }

  /**
   * NO KEY UPDATE conflicts with itself, so creations of one rule's cases count one after another;
   * a draft save takes the same lock and waits the same short time. Deletion's FOR UPDATE waits
   * too, so the rule still exists when the case is inserted.
   */
  @Override
  public int lockForNewCase(String ruleId) {
    var locked =
        jdbc.query(
            "SELECT id FROM rules WHERE id = ? FOR NO KEY UPDATE",
            (row, index) -> row.getString("id"),
            ruleId);
    if (locked.isEmpty()) throw ruleNotFound(ruleId);
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM rule_test_cases WHERE rule_id = ?", Integer.class, ruleId);
    return count == null ? 0 : count;
  }

  @Override
  public void lockCase(String ruleId, long id) {
    var locked =
        jdbc.query(
            "SELECT id FROM rule_test_cases WHERE rule_id = ? AND id = ? FOR UPDATE",
            (row, index) -> row.getLong("id"),
            ruleId,
            id);
    if (locked.isEmpty()) throw missing(ruleId, id);
  }

  @Override
  public RuleTestCase create(String ruleId, Content content) {
    Encoded encoded = encoded(content);
    var rows =
        jdbc.query(
            "INSERT INTO rule_test_cases (rule_id, name, inputs, expected_result, expected_error)"
                + " VALUES (?, ?, ?::jsonb, ?::jsonb, ?) RETURNING "
                + COLUMNS,
            mapper,
            ruleId,
            content.name(),
            encoded.inputs(),
            encoded.expectedResult(),
            content.expectedError());
    return rows.getFirst();
  }

  @Override
  public RuleTestCase update(String ruleId, long id, Content content) {
    Encoded encoded = encoded(content);
    var rows =
        jdbc.query(
            "UPDATE rule_test_cases SET name = ?, inputs = ?::jsonb, expected_result = ?::jsonb,"
                + " expected_error = ?, updated_at = now() WHERE rule_id = ? AND id = ? RETURNING "
                + COLUMNS,
            mapper,
            content.name(),
            encoded.inputs(),
            encoded.expectedResult(),
            content.expectedError(),
            ruleId,
            id);
    if (rows.isEmpty()) throw missing(ruleId, id);
    return rows.getFirst();
  }

  @Override
  public void delete(String ruleId, long id) {
    int deleted =
        jdbc.update("DELETE FROM rule_test_cases WHERE rule_id = ? AND id = ?", ruleId, id);
    if (deleted == 0) throw missing(ruleId, id);
  }

  /**
   * One statement copies the stored JSONB values as they are (120.00 stays 120.00) without passing
   * them through the codec; identity values follow the copied order, so the copies list as the
   * originals did.
   */
  @Override
  public int copyCases(String from, String to) {
    return jdbc.update(
        "INSERT INTO rule_test_cases (rule_id, name, inputs, expected_result, expected_error)"
            + " SELECT ?, name, inputs, expected_result, expected_error FROM rule_test_cases"
            + " WHERE rule_id = ? ORDER BY id",
        to,
        from);
  }

  /** The JSON a write stores; the expected result is SQL NULL when a failure is expected. */
  private record Encoded(String inputs, String expectedResult) {}

  private Encoded encoded(Content content) {
    StoredText.requireStorable(content.name(), content.expectedError());
    String inputs = json.encode(content.inputs());
    String expected =
        content.expectedError() == null ? json.encode(content.expectedResult()) : null;
    long bytes = utf8Bytes(inputs) + (expected == null ? 0 : utf8Bytes(expected));
    if (bytes > Limits.MAX_TEST_CASE_BYTES)
      throw ArcException.invalid(
          "Test case inputs and expected result exceed "
              + Limits.formatBytes(Limits.MAX_TEST_CASE_BYTES));
    return new Encoded(inputs, expected);
  }

  private static long utf8Bytes(String text) {
    return text.getBytes(StandardCharsets.UTF_8).length;
  }

  /** An unknown rule is named first, so a case path under a missing rule says the rule is gone. */
  private ArcException missing(String ruleId, long id) {
    RuleRows.requireRule(jdbc, ruleId);
    return ArcException.notFound("Test case not found: " + id);
  }

  private Map<String, Object> inputs(String text) {
    Map<?, ?> stored = json.decode(text, Map.class);
    var inputs = new LinkedHashMap<String, Object>();
    // JSON object keys are always text.
    for (var input : stored.entrySet()) inputs.put((String) input.getKey(), input.getValue());
    return inputs;
  }

  /** SQL NULL (a failure is expected) and the JSON null (a null result is) both read as null. */
  private Object expectedResult(String text) {
    return text == null ? null : json.decode(text, Object.class);
  }
}
