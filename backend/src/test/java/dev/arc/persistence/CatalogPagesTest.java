package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import dev.arc.model.CatalogPage;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class CatalogPagesTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final RowMapper<String> rows = (row, index) -> row.getString("id");

  @Test
  void totalCountsEveryMatchWhileThePageTakesLimitThenOffsetAfterTheFilter() {
    when(jdbc.queryForObject("count", Long.class, "tax", "RULE")).thenReturn(42L);
    when(jdbc.query(eq("page"), eq(rows), eq("tax"), eq("RULE"), eq(10), eq(40)))
        .thenReturn(List.of("tax-rate"));

    assertThat(CatalogPages.read(jdbc, "count", "page", rows, 40, 10, "tax", "RULE"))
        .isEqualTo(new CatalogPage<>(List.of("tax-rate"), 42, 40, 10));
  }

  @Test
  void anUnfilteredHistoryPassesOnlyThePageBounds() {
    when(jdbc.queryForObject(eq("count"), eq(Long.class), any(Object[].class))).thenReturn(0L);
    when(jdbc.query("page", rows, 20, 0)).thenReturn(List.of());

    assertThat(CatalogPages.read(jdbc, "count", "page", rows, 0, 20))
        .isEqualTo(new CatalogPage<String>(List.of(), 0, 0, 20));
  }
}
