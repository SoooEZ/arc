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
  private final Map<String, Set<String>> ancestors = new HashMap<>();
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
      Set<String> predecessors = new HashSet<>();
      for (Edge edge : incoming(id)) {
        predecessors.add(edge.source());
        predecessors.addAll(ancestors.get(edge.source()));
      }
      ancestors.put(id, Set.copyOf(predecessors));
      for (Edge edge : outgoing(id)) {
        if (unresolvedParents.merge(edge.target(), -1, Integer::sum) == 0) ready.add(edge.target());
      }
    }
    if (sorted.size() != nodes.size()) {
      Node blocked =
          nodes.values().stream()
              .filter(node -> unresolvedParents.get(node.id()) > 0)
              .findFirst()
              .orElseThrow();
      throw ArcException.invalid("Decision graphs cannot contain cycles")
          .atNode(null, null, blocked.id(), blocked.label());
    }
    order = List.copyOf(sorted);
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

  boolean isAncestor(String earlier, String later) {
    return ancestors.get(later).contains(earlier);
  }
}
