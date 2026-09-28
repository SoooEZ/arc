package dev.arc.engine;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Identifier and resource-ID syntax shared by expressions, declarations, sources and commands. */
public final class Identifiers {
  /**
   * Regular-expression syntax of a Switch case ID, which its {@code case:<id>} connection handle
   * repeats: letters, digits, underscores and hyphens.
   */
  public static final String CASE_ID_SYNTAX =
      "[A-Za-z0-9_-]{1," + Limits.MAX_CASE_ID_CHARACTERS + "}";

  private static final Pattern NAME =
      Pattern.compile("[A-Za-z_][A-Za-z_0-9]{0," + (Limits.MAX_IDENTIFIER_CHARACTERS - 1) + "}");
  private static final Pattern RESOURCE_ID =
      Pattern.compile("[a-z][a-z0-9-]{0," + (Limits.MAX_RESOURCE_ID_CHARACTERS - 1) + "}");
  private static final Set<String> RESERVED = Set.of("true", "false", "null", "and", "or");

  private Identifiers() {}

  public static boolean isValid(String name) {
    return name != null
        && NAME.matcher(name).matches()
        && !RESERVED.contains(name.toLowerCase(Locale.ROOT));
  }

  /**
   * Rule and data source IDs, including the pins in source bindings and {@code @id:version} Formula
   * calls: a lowercase letter followed by lowercase letters, digits or hyphens.
   */
  public static boolean isResourceId(String id) {
    return id != null && RESOURCE_ID.matcher(id).matches();
  }
}
