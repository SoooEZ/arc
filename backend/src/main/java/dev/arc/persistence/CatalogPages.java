package dev.arc.persistence;

import dev.arc.model.CatalogPage;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.StringJoiner;
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
   * A catalog's search condition: an empty search matches every row, any other matches within one
   * of {@code columns}, ignoring case. Each column is searched on its own: joined by spaces, "tax
   * rate" found the rule tax named "Rate table". The condition binds the search once for the empty
   * check and once per column ({@link #searchArguments}); a per-row subplan over an unnested array
   * of the columns took the same search twice at about twice the cost (measured on PostgreSQL 17:
   * 14 against 8 ms per search at 10,000 rules, 139 against 35 ms at 100,000).
   */
  static String searchWithin(String... columns) {
    var condition = new StringJoiner(" OR ", "(? = '' OR ", ")");
    for (String column : columns) condition.add("strpos(lower(" + column + "), lower(?)) > 0");
    return condition.toString();
  }

  /** The search, once per placeholder of {@link #searchWithin} over the same columns. */
  static List<Object> searchArguments(String search, String... columns) {
    return Collections.nCopies(columns.length + 1, search);
  }

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
    return read(jdbc, countSql, pageSql, rows, offset, limit, filterArguments, new Object[0]);
  }

  /**
   * A page whose statement goes on after choosing its rows: {@code pageSql} takes {@code
   * filterArguments}, then the page size and the offset ({@code LIMIT ? OFFSET ?}), then {@code
   * selectArguments} for the columns it computes for the chosen rows alone.
   */
  static <T> CatalogPage<T> read(
      JdbcTemplate jdbc,
      String countSql,
      String pageSql,
      RowMapper<T> rows,
      int offset,
      int limit,
      Object[] filterArguments,
      Object... selectArguments) {
    long total = jdbc.queryForObject(countSql, Long.class, filterArguments);
    var pageArguments = new ArrayList<>(Arrays.asList(filterArguments));
    pageArguments.add(limit);
    pageArguments.add(offset);
    pageArguments.addAll(Arrays.asList(selectArguments));
    return new CatalogPage<>(
        jdbc.query(pageSql, rows, pageArguments.toArray()), total, offset, limit);
  }
}
