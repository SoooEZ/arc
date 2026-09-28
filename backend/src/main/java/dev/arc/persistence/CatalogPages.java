package dev.arc.persistence;

import dev.arc.model.CatalogPage;
import java.util.Arrays;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Reads one catalog or version-history page for the JDBC repositories. The total counts every
 * matching row, while only the requested slice is read and mapped. The count and the page are
 * separate statements, so concurrent edits can move items between page requests.
 */
final class CatalogPages {
  private CatalogPages() {}

  /**
   * Both statements take {@code filterArguments} first. {@code pageSql} then takes the page size
   * and the offset as its last two parameters ({@code LIMIT ? OFFSET ?}).
   */
  static <T> CatalogPage<T> read(
      JdbcTemplate jdbc,
      String countSql,
      String pageSql,
      RowMapper<T> rows,
      int offset,
      int limit,
      Object... filterArguments) {
    long total = jdbc.queryForObject(countSql, Long.class, filterArguments);
    Object[] pageArguments = Arrays.copyOf(filterArguments, filterArguments.length + 2);
    pageArguments[filterArguments.length] = limit;
    pageArguments[filterArguments.length + 1] = offset;
    return new CatalogPage<>(jdbc.query(pageSql, rows, pageArguments), total, offset, limit);
  }
}
