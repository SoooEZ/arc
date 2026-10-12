package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.StorableText;

/** The display name of a rule or data source, as stored: one line of 1 to 160 characters. */
public final class DisplayNames {
  private DisplayNames() {}

  /**
   * The name to store: trimmed, 1 to {@link Limits#MAX_NAME_CHARACTERS} characters afterwards, and
   * without control characters, which trimming would otherwise drop silently (a name of U+0001 and
   * U+0000 alone was stored empty, past the NUL check); text storage cannot hold is refused with
   * storage's message. {@code resource} is the message's subject, "Rule" or "Source"; both share
   * this one policy.
   */
  public static String normalize(String resource, String name) {
    if (name == null) throw invalidLength(resource);
    // Storage's own messages first: a NUL is named as such, not as a control character.
    String unstorable = StorableText.problem(name);
    if (unstorable != null) throw ArcException.invalid(unstorable);
    for (int index = 0; index < name.length(); index++)
      if (Character.isISOControl(name.charAt(index)))
        throw ArcException.invalid(resource + " name cannot contain control characters");
    // trim() removes only characters up to U+0020, and String.isBlank sees only what
    // Character.isWhitespace names: a name of full-width (U+3000), em (U+2003) or no-break spaces
    // (U+00A0, U+2007, U+202F) would be stored and shown as a blank title.
    String trimmed = name.trim();
    if (blank(trimmed) || trimmed.length() > Limits.MAX_NAME_CHARACTERS)
      throw invalidLength(resource);
    return trimmed;
  }

  /**
   * Whether every code point is a space: whitespace or a space separator, no-break ones included.
   */
  private static boolean blank(String text) {
    return text.codePoints()
        .allMatch(point -> Character.isWhitespace(point) || Character.isSpaceChar(point));
  }

  private static ArcException invalidLength(String resource) {
    return ArcException.invalid(
        resource + " name must contain 1 to " + Limits.MAX_NAME_CHARACTERS + " characters");
  }
}
