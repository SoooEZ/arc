package dev.arc.engine.validation;

import java.util.List;

/** How validation messages phrase a list of names, in one place for every check. */
final class Wording {
  private Wording() {}

  /** "A", "A and B", "A, B and C". */
  static String listed(List<String> names) {
    if (names.size() == 1) return names.getFirst();
    return String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.getLast();
  }
}
