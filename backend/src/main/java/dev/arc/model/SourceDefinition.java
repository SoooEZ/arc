package dev.arc.model;

import dev.arc.model.Definition.Input;
import java.util.List;
import java.util.Map;

public record SourceDefinition(
    String kind,
    String url,
    List<Input> parameters,
    Map<String, Object> entries,
    Map<String, String> secretHeaders,
    int timeoutMs) {}
