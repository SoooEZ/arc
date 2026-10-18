package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.StreamWriteFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.error.ArcException;
import dev.arc.model.RuleTestCase;
import dev.arc.rule.RuleTestCaseRepository.Content;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class JdbcRuleTestCaseRepositoryTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

  /** The application's decimal settings: floats read as BigDecimal and written in plain digits. */
  private final JdbcRuleTestCaseRepository repository =
      new JdbcRuleTestCaseRepository(
          jdbc,
          new JsonCodec(
              JsonMapper.builder()
                  .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                  .enable(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN)
                  .build()));

  private final List<String> statements = new ArrayList<>();
  private final List<List<Object>> arguments = new ArrayList<>();

  /** Answers every row query with one stored row, as an INSERT or UPDATE … RETURNING does. */
  private void returnRow(ResultSet row) {
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              Object[] values = call.getArguments();
              statements.add(call.getArgument(0));
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of(call.<RowMapper<Object>>getArgument(1).mapRow(row, 0));
            });
  }

  private static ResultSet storedRow(String inputs, String expectedResult, String expectedError)
      throws Exception {
    var row = mock(ResultSet.class);
    when(row.getLong("id")).thenReturn(12L);
    when(row.getString("rule_id")).thenReturn("pricing");
    when(row.getString("name")).thenReturn("Premium order");
    when(row.getString("inputs")).thenReturn(inputs);
    when(row.getString("expected_result")).thenReturn(expectedResult);
    when(row.getString("expected_error")).thenReturn(expectedError);
    when(row.getTimestamp(anyString())).thenReturn(Timestamp.from(Instant.EPOCH));
    return row;
  }

  /**
   * A case is stored as the codec writes JSON and read back as stored: 120.00 keeps its places in
   * both directions, and the inputs come back as the object PostgreSQL holds.
   */
  @Test
  void aCaseIsInsertedAsJsonAndReturnedAsStored() throws Exception {
    returnRow(storedRow("{\"orderTotal\": 150, \"customerTier\": \"premium\"}", "120.00", null));
    var inputs = new LinkedHashMap<String, Object>();
    inputs.put("orderTotal", 150);
    inputs.put("customerTier", "premium");

    RuleTestCase created =
        repository.create(
            "pricing", new Content("Premium order", inputs, new BigDecimal("120.00"), null));

    assertThat(statements)
        .containsExactly(
            "INSERT INTO rule_test_cases (rule_id, name, inputs, expected_result, expected_error)"
                + " VALUES (?, ?, ?::jsonb, ?::jsonb, ?) RETURNING id, rule_id, name, inputs,"
                + " expected_result, expected_error, created_at, updated_at");
    assertThat(arguments.getFirst())
        .containsExactly(
            "pricing",
            "Premium order",
            "{\"orderTotal\":150,\"customerTier\":\"premium\"}",
            "120.00",
            null);
    assertThat(created)
        .isEqualTo(
            new RuleTestCase(
                12,
                "pricing",
                "Premium order",
                Map.of("orderTotal", 150, "customerTier", "premium"),
                new BigDecimal("120.00"),
                null,
                Instant.EPOCH,
                Instant.EPOCH));
  }

  /**
   * An expected failure stores SQL NULL as its result, which the table's check requires, while a
   * case expecting a null result stores the JSON null; both read back as a null expected result.
   */
  @Test
  void anExpectedFailureStoresNoResultWhileANullResultIsTheJsonNull() throws Exception {
    returnRow(storedRow("{}", null, "Missing required input"));
    RuleTestCase failing =
        repository.update("pricing", 3, new Content("Fails", Map.of(), null, "Missing required"));
    assertThat(statements.getFirst())
        .isEqualTo(
            "UPDATE rule_test_cases SET name = ?, inputs = ?::jsonb, expected_result = ?::jsonb,"
                + " expected_error = ?, updated_at = now() WHERE rule_id = ? AND id = ? RETURNING"
                + " id, rule_id, name, inputs, expected_result, expected_error, created_at,"
                + " updated_at");
    assertThat(arguments.getFirst())
        .containsExactly("Fails", "{}", null, "Missing required", "pricing", 3L);
    assertThat(failing.expectedResult()).isNull();
    assertThat(failing.expectedError()).isEqualTo("Missing required input");

    repository.create("pricing", new Content("Null", Map.of(), null, null));
    assertThat(arguments.get(1)).containsExactly("pricing", "Null", "{}", "null", null);
  }

  @Test
  void aCaseTooLargeToStoreIsRefusedBeforeAnyStatement() {
    var inputs = Map.<String, Object>of("text", "x".repeat(64 * 1024));
    assertThatThrownBy(() -> repository.create("pricing", new Content("Big", inputs, null, null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(422))
        .hasMessage("Test case inputs and expected result exceed 64 KiB");
    assertThatThrownBy(
            () ->
                repository.update(
                    "pricing", 1, new Content("Big", Map.of(), inputs.get("text"), null)))
        .hasMessage("Test case inputs and expected result exceed 64 KiB");
    verifyNoInteractions(jdbc);
  }

  /**
   * A new case counts the cases under the rule's NO KEY UPDATE lock, which conflicts with itself,
   * so concurrent creations count one after another.
   */
  @Test
  void aNewCaseLocksTheRuleAndCountsItsCases() {
    when(jdbc.query(
            eq("SELECT id FROM rules WHERE id = ? FOR NO KEY UPDATE"),
            any(RowMapper.class),
            eq("pricing")))
        .thenReturn(List.of("pricing"));
    when(jdbc.queryForObject(
            "SELECT count(*) FROM rule_test_cases WHERE rule_id = ?", Integer.class, "pricing"))
        .thenReturn(42);
    assertThat(repository.lockForNewCase("pricing")).isEqualTo(42);

    when(jdbc.query(
            eq("SELECT id FROM rules WHERE id = ? FOR NO KEY UPDATE"),
            any(RowMapper.class),
            eq("gone")))
        .thenReturn(List.of());
    assertThatThrownBy(() -> repository.lockForNewCase("gone"))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Rule not found: gone");
    verify(jdbc, never()).queryForObject(anyString(), eq(Integer.class), eq("gone"));
  }

  /** A missing rule is named before a missing case, so a path under a deleted rule says so. */
  @Test
  void aMissingRuleOrCaseIsNotFound() {
    when(jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM rules WHERE id = ?)", Boolean.class, "pricing"))
        .thenReturn(true);
    when(jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM rules WHERE id = ?)", Boolean.class, "gone"))
        .thenReturn(false);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());

    assertThatThrownBy(() -> repository.list("gone")).hasMessage("Rule not found: gone");
    assertThatThrownBy(() -> repository.lockCase("pricing", 7))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Test case not found: 7");
    assertThatThrownBy(() -> repository.lockCase("gone", 7)).hasMessage("Rule not found: gone");
    assertThatThrownBy(
            () -> repository.update("pricing", 7, new Content("Case", Map.of(), null, null)))
        .hasMessage("Test case not found: 7");
    assertThatThrownBy(() -> repository.delete("pricing", 7)).hasMessage("Test case not found: 7");
    assertThatThrownBy(() -> repository.delete("gone", 7)).hasMessage("Rule not found: gone");
    // The case list of a missing rule is never read.
    verify(jdbc, never())
        .query(
            eq(
                "SELECT id, rule_id, name, inputs, expected_result, expected_error, created_at,"
                    + " updated_at FROM rule_test_cases WHERE rule_id = ? ORDER BY id"),
            any(RowMapper.class),
            eq("gone"));
  }

  /**
   * A duplicated rule's cases are copied in one statement, in their order and as stored, so their
   * JSON never passes through the codec; the copy reports how many cases it made.
   */
  @Test
  void casesAreCopiedToAnotherRuleInOneStatementAsStored() {
    when(jdbc.update(anyString(), any(Object[].class))).thenReturn(3);

    assertThat(repository.copyCases("pricing", "pricing-copy")).isEqualTo(3);

    verify(jdbc)
        .update(
            "INSERT INTO rule_test_cases (rule_id, name, inputs, expected_result, expected_error)"
                + " SELECT ?, name, inputs, expected_result, expected_error FROM rule_test_cases"
                + " WHERE rule_id = ? ORDER BY id",
            "pricing-copy",
            "pricing");
  }
}
