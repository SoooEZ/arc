package dev.arc.model;

public record CatalogPage<T>(java.util.List<T> items, long total, int offset, int limit) {}
