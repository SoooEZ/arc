package dev.arc.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;

/** Column reading that every repository's row mappers share. */
final class Rows {
  private Rows() {}

  /** A {@code timestamptz} column as an instant. */
  static Instant instant(ResultSet row, String column) throws SQLException {
    return row.getTimestamp(column).toInstant();
  }
}
