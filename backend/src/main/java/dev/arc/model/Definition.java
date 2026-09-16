package dev.arc.model;

import java.util.List;
import java.util.Map;

/** Portable executable graph. Presentation coordinates never affect execution. */
public record Definition(int schemaVersion, List<Input> inputs, List<Node> nodes, List<Edge> edges) {
    public record Input(String name, String type, boolean required, Object defaultValue) {}
    public record Position(double x, double y) {}
    public record Node(String id, String type, String label, Position position,
                       String expression, String output, String ruleId, Integer version,
                       Map<String, String> bindings) {}
    public record Edge(String id, String source, String target, String sourceHandle) {}
}
