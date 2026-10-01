package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.DataSource;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
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
