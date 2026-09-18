package dev.arc.model;

import java.time.Instant;

/** A mutable draft with an optimistic revision and an optional published version. */
public record Rule(
    String id,
    String name,
    String description,
    String kind,
    Definition draft,
    int revision,
    Integer publishedVersion,
    Instant createdAt,
    Instant updatedAt) {}
