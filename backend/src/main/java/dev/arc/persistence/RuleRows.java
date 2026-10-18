package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Rule;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * The rules table as the rule repositories read it: a row as a {@link Rule}, whether a rule exists,
 * and the 404 a missing one answers. "Rule not found: id" is part of the API, so it is written here
 * once.
 */
final class RuleRows {
  private RuleRows() {}

  /** A {@code rules} row as a rule, its draft decoded. */
  static RowMapper<Rule> mapper(JsonCodec json) {
    return (row, index) ->
        new Rule(
            row.getString("id"),
            row.getString("name"),
            row.getString("description"),
            row.getString("kind"),
            json.decode(row.getString("draft"), Definition.class),
            row.getInt("revision"),
            row.getObject("published_version", Integer.class),
            Rows.instant(row, "created_at"),
            Rows.instant(row, "updated_at"));
  }

  /** Refuses a rule that does not exist, without reading or locking its row. */
  static void requireRule(JdbcTemplate jdbc, String id) {
    boolean exists =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM rules WHERE id = ?)", Boolean.class, id));
    if (!exists) throw ruleNotFound(id);
  }

  static ArcException ruleNotFound(String id) {
    return ArcException.notFound("Rule not found: " + id);
  }
}
