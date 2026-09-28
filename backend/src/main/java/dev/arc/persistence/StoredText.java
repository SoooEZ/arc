package dev.arc.persistence;

import dev.arc.error.ArcException;

/**
 * PostgreSQL text columns and JSONB strings cannot hold U+0000. Writes reject it as an invalid
 * value before storing anything; the database would otherwise fail the statement with an internal
 * error.
 */
final class StoredText {
  static final String NUL_MESSAGE = "Text cannot contain the NUL character (U+0000)";

  private StoredText() {}

  /** Column values such as names and descriptions; null values are allowed. */
  static void requireStorable(String... values) {
    for (String value : values)
      if (value != null && value.indexOf('\0') >= 0) throw ArcException.invalid(NUL_MESSAGE);
  }

  /**
   * Encoded JSON, in which U+0000 inside a string is the escape <code>&#92;u0000</code>. Each
   * backslash starts an escape, so an escaped backslash followed by the text "u0000" is allowed.
   */
  static void requireStorableJson(String json) {
    for (int escape = json.indexOf('\\'); escape >= 0; escape = json.indexOf('\\', escape + 2))
      if (json.startsWith("u0000", escape + 1)) throw ArcException.invalid(NUL_MESSAGE);
  }
}
