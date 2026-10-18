package dev.arc.model;

/** A published version in a version list; {@code note} is what its publisher wrote, or null. */
public record RuleVersionSummary(
    String ruleId, int version, java.time.Instant publishedAt, String note) {}
