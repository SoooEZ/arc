package dev.arc.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The kinds of rule; a rule's JSON {@code kind} is the constant's name, and the {@code rules.kind}
 * CHECK constraint of the first migration lists the same names. A new kind needs a new migration
 * that replaces that constraint; the applied one is never edited.
 */
public enum RuleKind {
  DECISION_TREE,
  FORMULA,
  RULE;

  /** The kind a name spells exactly; empty for null, unknown or differently cased names. */
  public static Optional<RuleKind> parse(String name) {
    for (RuleKind kind : values()) if (kind.name().equals(name)) return Optional.of(kind);
    return Optional.empty();
  }

  /** Whether an expression may call a published version of this kind with {@code @id:version}. */
  public boolean callableByFormula() {
    return switch (this) {
      case FORMULA -> true;
      case DECISION_TREE, RULE -> false;
    };
  }

  /** The kinds as a choice, for messages: {@code DECISION_TREE, FORMULA, or RULE}. */
  public static String choices() {
    List<String> names = new ArrayList<>();
    for (RuleKind kind : values()) names.add(kind.name());
    return String.join(", ", names.subList(0, names.size() - 1)) + ", or " + names.getLast();
  }
}
