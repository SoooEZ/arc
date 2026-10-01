package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.StreamWriteFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.model.DataSource;
import dev.arc.model.SourceDefinition;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class JdbcSourceRepositoryTest {
  private static final String VERSION_ROWS =
      "SELECT s.id, s.name, v.version, v.definition FROM data_sources s"
          + " JOIN data_source_versions v ON v.source_id = s.id";

  private final JdbcTemplate db = mock(JdbcTemplate.class);
  private final JdbcSourceRepository repository =
      new JdbcSourceRepository(db, new JsonCodec(new ObjectMapper()));

  /**
   * A lookup table is stored as responses write it, every number in plain decimals: a thousand
   * entries of twenty "1e100" each fit a save but not the save the source editor sends back.
   */
  @Test
  void aSourceTooLargeToSaveBackOnceItsNumbersAreWrittenOutIsRefused() {
    var plainNumbers =
        new JdbcSourceRepository(
            db,
            new JsonCodec(
                JsonMapper.builder().enable(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN).build()));
    var entries = new LinkedHashMap<String, Object>();
    for (int index = 0; index < 1_000; index++)
      entries.put("key" + index, Collections.nCopies(20, new BigDecimal("1E+100")));
    var table = new SourceDefinition("LOOKUP", null, List.of(), entries, Map.of(), 1_000);
    String tooLarge =
        "Definition exceeds 960 KiB once its numbers are written out in full, more than a save"
            + " can send back";
    assertThatThrownBy(() -> plainNumbers.create("rates", "Rates", table)).hasMessage(tooLarge);
    assertThatThrownBy(() -> plainNumbers.appendVersion("rates", "Rates", 1, table))
        .hasMessage(tooLarge);
    verifyNoInteractions(db);
  }

  /**
   * Every read of a source version selects what its row mapper reads through one statement start:
   * the four reads spelled it separately, so a column missed in one failed only that path, with a
   * 500 that no test reached.
   */
  @Test
  void everyVersionReadSelectsTheColumnsItsMapperReads() throws Exception {
    var row = mock(ResultSet.class);
    when(row.getString("id")).thenReturn("rates");
    when(row.getString("name")).thenReturn("Rates");
    when(row.getInt("version")).thenReturn(2);
    when(row.getString("definition"))
        .thenReturn("{\"kind\":\"LOOKUP\",\"parameters\":[],\"entries\":{},\"timeoutMs\":1000}");
    var statements = new ArrayList<String>();
    when(db.query(anyString(), any(RowMapper.class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of(call.<RowMapper<?>>getArgument(1).mapRow(row, 0));
            });
    when(db.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              return List.of(call.<RowMapper<?>>getArgument(1).mapRow(row, 0));
            });
    when(db.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);

    var reads =
        List.of(
            repository.list().getFirst(),
            repository.get("rates", 2),
            repository.latest("rates"),
            repository.versions("rates").getFirst());

    assertThat(reads)
        .extracting(DataSource::id, DataSource::version)
        .containsOnly(org.assertj.core.groups.Tuple.tuple("rates", 2));
    assertThat(statements)
        .containsExactly(
            VERSION_ROWS + " AND v.version = s.version ORDER BY s.updated_at DESC",
            VERSION_ROWS + " WHERE s.id = ? AND v.version = ?",
            VERSION_ROWS + " AND v.version = s.version WHERE s.id = ?",
            VERSION_ROWS + " WHERE s.id = ? ORDER BY v.version DESC");
  }
}
