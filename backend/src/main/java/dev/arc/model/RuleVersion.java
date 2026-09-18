package dev.arc.model;

import java.time.Instant;

/** An immutable snapshot; references always pin this version. */
public record RuleVersion(String ruleId, int version, Definition definition, Instant publishedAt) {}
