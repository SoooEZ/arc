package dev.arc.engine.graph;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import java.util.*;

/** Indexes a shaped graph and orders every parent before its children, breaking ties by node ID. */
final class GraphTopology {
  private final Map<String, List<Edge>> incoming = new HashMap<>();
  private final Map<String, List<Edge>> outgoing = new HashMap<>();
  private final List<Node> order;

  GraphTopology(Definition definition) {
    Map<String, Node> nodes = new LinkedHashMap<>();
    for (Node node : definition.nodes()) nodes.put(node.id(), node);
    for (Edge edge : definition.edges()) {
      incoming.computeIfAbsent(edge.target(), ignored -> new ArrayList<>()).add(edge);
      outgoing.computeIfAbsent(edge.source(), ignored -> new ArrayList<>()).add(edge);
    }
    incoming.replaceAll((id, edges) -> List.copyOf(edges));
    outgoing.replaceAll((id, edges) -> List.copyOf(edges));

    Map<String, Integer> unresolvedParents = new HashMap<>();
    Queue<String> ready = new PriorityQueue<>();
    for (Node node : definition.nodes()) {
      int count = incoming(node.id()).size();
      unresolvedParents.put(node.id(), count);
      if (count == 0) ready.add(node.id());
    }
    List<Node> sorted = new ArrayList<>();
    while (!ready.isEmpty()) {
      String id = ready.remove();
      sorted.add(nodes.get(id));
      for (Edge edge : outgoing(id)) {
        if (unresolvedParents.merge(edge.target(), -1, Integer::sum) == 0) ready.add(edge.target());
      }
    }
    if (sorted.size() != nodes.size()) throw cycleError(nodes, sorted);
    order = List.copyOf(sorted);
  }

  /**
   * Locates the error on one cycle. Every node left unordered still waits for an unordered parent,
   * so walking back through such parents must revisit a node on a cycle. Nodes that are merely
   * downstream of the cycle are not reported.
   */
  private ArcException cycleError(Map<String, Node> nodes, List<Node> sorted) {
    Set<String> unordered = new LinkedHashSet<>(nodes.keySet());
    for (Node node : sorted) unordered.remove(node.id());
    List<String> path = new ArrayList<>();
    String current = unordered.iterator().next();
    while (!path.contains(current)) {
      path.add(current);
      current = unorderedParent(current, unordered);
    }
    Set<String> cycle = Set.copyOf(path.subList(path.indexOf(current), path.size()));
    var error = ArcException.invalid("Decision graphs cannot contain cycles");
    for (Node node : nodes.values())
      if (cycle.contains(node.id())) error = error.atNode(null, null, node.id(), node.label());
    return error;
  }

  private String unorderedParent(String id, Set<String> unordered) {
    for (Edge edge : incoming(id)) if (unordered.contains(edge.source())) return edge.source();
    throw new IllegalStateException("Unordered node " + id + " has no unordered parent");
  }

  List<Node> order() {
    return order;
  }

  List<Edge> incoming(String id) {
    return incoming.getOrDefault(id, List.of());
  }

  List<Edge> outgoing(String id) {
    return outgoing.getOrDefault(id, List.of());
  }
}
