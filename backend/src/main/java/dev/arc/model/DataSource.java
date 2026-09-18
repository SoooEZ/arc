package dev.arc.model;

public record DataSource(String id, String name, int version, SourceDefinition definition) {}
