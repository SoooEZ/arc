package dev.arc.persistence;

import dev.arc.error.ArcException;
import dev.arc.model.StorableText;

/**
 * Writes reject text the database could not hold as written ({@link StorableText}) as an invalid
 * value before storing anything: PostgreSQL fails a statement with U+0000 with an internal error,
 * and the JDBC driver silently stored an unpaired UTF-16 surrogate as '?'.
 */
final class StoredText {
  static final String NUL_MESSAGE = StorableText.NUL_MESSAGE;

  private StoredText() {}

  /** Column values such as names and descriptions; null values are allowed. */
  static void requireStorable(String... values) {
    for (String value : values) {
      String problem = value == null ? null : StorableText.problem(value);
      if (problem != null) throw ArcException.invalid(problem);
    }
  }

  /**
   * Encoded JSON, in which U+0000 inside a string is the escape <code>&#92;u0000</code>. Each
   * backslash starts an escape, so an escaped backslash followed by the text "u0000" is allowed.
   * Jackson writes surrogates raw, so the encoded text shows an unpaired one as itself.
   */
  static void requireStorableJson(String json) {
    for (int escape = json.indexOf('\\'); escape >= 0; escape = json.indexOf('\\', escape + 2))
      if (json.startsWith("u0000", escape + 1)) throw ArcException.invalid(NUL_MESSAGE);
    String problem = StorableText.problem(json);
    if (problem != null) throw ArcException.invalid(problem);
  }
}
