package dev.arc.engine;

import dev.arc.model.Definition;

@FunctionalInterface
public interface RuleResolver {
    Definition resolve(String id, int version);
}
