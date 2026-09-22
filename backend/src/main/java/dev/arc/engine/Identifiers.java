package dev.arc.engine;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Identifier syntax shared by expressions, declared inputs and source parameters. */
public final class Identifiers {
  private static final Pattern NAME = Pattern.compile("[A-Za-z_][A-Za-z_0-9]{0,63}");
  private static final Set<String> RESERVED = Set.of("true", "false", "null", "and", "or");

  private Identifiers() {}

  public static boolean isValid(String name) {
    return name != null
        && NAME.matcher(name).matches()
        && !RESERVED.contains(name.toLowerCase(Locale.ROOT));
  }
}
