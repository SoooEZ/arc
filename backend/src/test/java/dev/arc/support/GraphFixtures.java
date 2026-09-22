package dev.arc.support;

import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.Position;

/** Small graph builders shared by evaluator and validator contract tests. */
public final class GraphFixtures {
  private GraphFixtures() {}

  public static Node node(String id, String type, String expression, String output) {
    return new Node(id, type, id, new Position(0, 0), expression, output, null, null, null);
  }

  public static Edge edge(String source, String target, String handle) {
    return new Edge(source + "-" + handle + "-" + target, source, target, handle);
  }
}
