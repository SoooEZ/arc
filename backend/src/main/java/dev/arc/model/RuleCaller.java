package dev.arc.model;

import java.util.List;

/**
 * Another rule that calls a rule, as {@code GET /rules/{id}/callers} lists it: the versions of the
 * rule that its saved draft and its latest published version pin, and how many of its earlier
 * versions call the rule too. {@code draftPins} is null when the saved draft does not call the rule
 * and empty while a Reference has chosen it without a version; {@code published} is null when the
 * caller is unpublished or its latest version does not call the rule.
 */
public record RuleCaller(
    String ruleId, String name, List<Integer> draftPins, Published published, int earlierVersions) {
  /** The caller's latest published version and the versions of the rule it pins. */
  public record Published(int version, List<Integer> pins) {}
}
