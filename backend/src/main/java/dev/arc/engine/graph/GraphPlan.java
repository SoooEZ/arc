package dev.arc.engine.graph;

import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Read-only topology and branch-sensitive scope plan for a structurally valid graph. */
public final class GraphPlan {
  /**
   * Writers of one variable whose writes all reach {@code node} whenever it runs, with no path
   * between any two of them. No write can then supersede another (a later writer supersedes an
   * earlier one only when the path that ran carried the earlier value into it), so every execution
   * reaching the node fails with "Conflicting upstream values"; the graph alone decides it, unlike
   * writes linked through a branch that may be skipped (lesson B8). Writers are node IDs in
   * execution order.
   */
  public record Conflict(String node, String variable, List<String> writers) {}

  private final GraphTopology topology;
  private final Map<String, Set<String>> available;
  private final Map<String, List<Conflict>> conflicts = new LinkedHashMap<>();

  public GraphPlan(Definition definition) {
    topology = new GraphTopology(definition);
    var analysis = new BranchScopes().analyze(definition, topology);
    available = analysis.available();
    for (Conflict conflict : analysis.conflicts())
      conflicts.computeIfAbsent(conflict.node(), node -> new ArrayList<>()).add(conflict);
  }

  public List<Node> order() {
    return topology.order();
  }

  public List<Edge> incoming(String id) {
    return topology.incoming(id);
  }

  public List<Edge> outgoing(String id) {
    return topology.outgoing(id);
  }

  public Map<String, Set<String>> available() {
    return available;
  }

  /** The conflicts that always happen at one node, in variable name order. */
  public List<Conflict> conflicts(String nodeId) {
    return List.copyOf(conflicts.getOrDefault(nodeId, List.of()));
  }
}
