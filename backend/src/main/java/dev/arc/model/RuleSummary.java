package dev.arc.model;

public record RuleSummary(
    String id,
    String name,
    String description,
    String kind,
    int revision,
    Integer publishedVersion,
    java.time.Instant createdAt,
    java.time.Instant updatedAt,
    int nodeCount,
    int inputCount,
    int referenceCount) {}
