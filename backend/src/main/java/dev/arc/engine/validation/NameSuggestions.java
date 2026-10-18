package dev.arc.engine.validation;

/**
 * The declared name that an unknown one most likely misspells, for a "did you mean …?" hint: the
 * same name in another case, or a name within one edit, or two edits for an unknown name of {@link
 * #TWO_EDITS_FROM} or more characters. Shorter names allow only one edit, since two edits turn most
 * short names into each other.
 */
final class NameSuggestions {
  /** Unknown names at least this long may be two edits from their suggestion. */
  static final int TWO_EDITS_FROM = 6;

  private NameSuggestions() {}

  /**
   * The candidate closest to {@code unknown}, or null when none qualifies. A difference of case
   * alone is the closest; otherwise fewer edits win, and a tie goes to the earlier candidate, so
   * callers pass declared names in declaration order.
   */
  static String closest(String unknown, Iterable<String> candidates) {
    int allowed = unknown.length() >= TWO_EDITS_FROM ? 2 : 1;
    String closest = null;
    int closestDistance = allowed + 1;
    for (String candidate : candidates) {
      if (candidate.equals(unknown)) continue;
      int distance = candidate.equalsIgnoreCase(unknown) ? 0 : edits(unknown, candidate, allowed);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }
    return closest;
  }

  /**
   * The Damerau–Levenshtein distance in its optimal-string-alignment form, where an insertion, a
   * deletion, a substitution or a swap of two adjacent characters each count one edit; {@code limit
   * + 1} for names whose lengths alone differ by more than {@code limit}.
   */
  static int edits(String from, String to, int limit) {
    if (Math.abs(from.length() - to.length()) > limit) return limit + 1;
    int[][] distance = new int[from.length() + 1][to.length() + 1];
    for (int i = 0; i <= from.length(); i++) distance[i][0] = i;
    for (int j = 0; j <= to.length(); j++) distance[0][j] = j;
    for (int i = 1; i <= from.length(); i++)
      for (int j = 1; j <= to.length(); j++) {
        int substitution = from.charAt(i - 1) == to.charAt(j - 1) ? 0 : 1;
        int best =
            Math.min(
                Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1),
                distance[i - 1][j - 1] + substitution);
        boolean swapped =
            i > 1
                && j > 1
                && from.charAt(i - 1) == to.charAt(j - 2)
                && from.charAt(i - 2) == to.charAt(j - 1);
        if (swapped) best = Math.min(best, distance[i - 2][j - 2] + 1);
        distance[i][j] = best;
      }
    return distance[from.length()][to.length()];
  }
}
