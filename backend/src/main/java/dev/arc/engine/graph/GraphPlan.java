package dev.arc.engine.graph;

import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Read-only topology and branch-sensitive scope plan for a structurally valid graph. */
public final class GraphPlan {
  private final GraphTopology topology;
  private final Map<String, Set<String>> available;

  public GraphPlan(Definition definition) {
    topology = new GraphTopology(definition);
    available = new BranchScopes().analyze(definition, topology);
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

  public boolean isAncestor(String earlier, String later) {
    return topology.isAncestor(earlier, later);
  }
}
