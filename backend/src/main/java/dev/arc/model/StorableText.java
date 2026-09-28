package dev.arc.model;

/**
 * What stored and searched text can hold. PostgreSQL text and JSONB cannot store U+0000 and fail
 * the statement with an internal error, and the JDBC driver silently replaces an unpaired UTF-16
 * surrogate with '?', altering names, drafts and lookup keys; a valid pair (an emoji) is ordinary
 * text. Persistence checks writes and paging checks searches against the same rules.
 */
public final class StorableText {
  public static final String NUL_MESSAGE = "Text cannot contain the NUL character (U+0000)";
  public static final String SURROGATE_MESSAGE = "Text cannot contain an unpaired UTF-16 surrogate";

  private StorableText() {}

  /** Null for text the database holds as written, else the message naming the problem. */
  public static String problem(String text) {
    if (text.indexOf('\0') >= 0) return NUL_MESSAGE;
    for (int index = 0; index < text.length(); index++) {
      char c = text.charAt(index);
      if (Character.isHighSurrogate(c)
          && index + 1 < text.length()
          && Character.isLowSurrogate(text.charAt(index + 1))) {
        index++;
      } else if (Character.isSurrogate(c)) {
        return SURROGATE_MESSAGE;
      }
    }
    return null;
  }
}
