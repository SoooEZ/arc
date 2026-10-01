package dev.arc.engine.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.script.ArcScriptParser.Parsed;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import dev.arc.engine.validation.ShapeViolation;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import dev.arc.model.NodeKind;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/** Studio boundary: build and render graphs without evaluating expressions or fetching data. */
@Component
public class ArcScript {
  private final Validator validator;
  private final ArcScriptParser parser;
  private final ArcScriptRenderer renderer;

  public record Diagnostic(String message, int line, int column) {}

  public record Build(Definition definition, String source, List<Diagnostic> diagnostics) {}

  public ArcScript(ObjectMapper json, Validator validator) {
    this.validator = validator;
    this.parser = new ArcScriptParser(json);
    this.renderer = new ArcScriptRenderer(json);
  }

  /** Draft-shape problems point at the statement that declared the offending element. */
  public Build build(String source) {
    try {
      Parsed parsed = parser.parse(source);
      rejectShapeViolation(parsed.definition(), parsed.locations());
      return new Build(parsed.definition(), renderer.render(parsed.definition(), null), List.of());
    } catch (SyntaxException failure) {
      return failedBuild(source, failure.getMessage(), failure.line, failure.column);
    }
  }

  public Definition parse(String source) {
    return parser.parse(source).definition();
  }

  /**
   * The notes a draft keeps for one note: one per line, each without surrounding whitespace, the
   * only form an ARC Script comment can carry. A build returns notes in this form.
   */
  public static List<String> noteLines(String note) {
    return ArcScriptSyntax.commentLines(note);
  }

  public String render(Definition definition) {
    validator.shape(definition);
    return renderer.render(definition, null);
  }

  public String renderNode(Definition definition, String nodeId) {
    validator.shape(definition);
    findNode(definition, nodeId);
    return renderer.render(definition, nodeId);
  }

  /**
   * Replaces one node from its fragment. Problems in the fragment point at its statements; an
   * invalid containing graph or unknown node is reported at the start of the fragment.
   */
  public Build buildNode(Definition definition, String nodeId, String source) {
    try {
      validator.shape(definition);
      Node original = findNode(definition, nodeId);
      Parsed fragment = parser.parseFragment(source, original.position());
      Definition merged = replaceNode(definition, original, fragment);
      rejectShapeViolation(merged, fragment.locations());
      return new Build(merged, renderer.render(merged, nodeId), List.of());
    } catch (SyntaxException failure) {
      return failedBuild(source, failure.getMessage(), failure.line, failure.column);
    } catch (ArcException failure) {
      return failedBuild(source, failure.getMessage(), 1, 1);
    }
  }

  private void rejectShapeViolation(Definition definition, ScriptLocations locations) {
    var violation = validator.shapeViolation(definition);
    if (violation.isPresent()) throw locations.error(violation.get());
  }

  private Node findNode(Definition definition, String nodeId) {
    return definition.nodes().stream()
        .filter(node -> node.id().equals(nodeId))
        .findFirst()
        .orElseThrow(() -> ArcException.invalid("Node not found"));
  }

  private Definition replaceNode(Definition definition, Node original, Parsed parsed) {
    Definition fragment = parsed.definition();
    if (fragment.nodes().size() != 1
        || !fragment.nodes().getFirst().id().equals(original.id())
        || fragment.nodes().getFirst().kind() != original.kind()) {
      throw parsed
          .locations()
          .error(
              "Keep exactly this node, with the same ID and type. Use Code studio to edit the"
                  + " whole graph.",
              unexpectedNode(fragment.nodes()));
    }
    boolean editsInputs = original.kind() == NodeKind.INPUT;
    if (!editsInputs && !fragment.inputs().isEmpty()) {
      throw parsed
          .locations()
          .error("Edit parameters in the Input node.", fragment.inputs().getFirst());
    }
    // Comments render only at the top of the whole graph's code; dropping them silently lost
    // what the user typed, so the refusal is a diagnostic at the first comment.
    if (fragment.notes() != null && !fragment.notes().isEmpty()) {
      throw parsed
          .locations()
          .error(
              new ShapeViolation(
                  "Comments belong to the whole graph; add them in Code studio",
                  new ShapeViolation.Note(0)));
    }

    // A fragment owns only its node and outgoing edges. Incoming edges and notes
    // belong to the containing graph; an Input fragment also owns its parameters.
    // The fragment's edges take the place of the first replaced edge, so an
    // unchanged fragment echoes the edges in their stored order.
    var edges = new ArrayList<Edge>();
    int replacedAt = -1;
    for (Edge edge : definition.edges()) {
      if (!edge.source().equals(original.id())) edges.add(edge);
      else if (replacedAt < 0) replacedAt = edges.size();
    }
    edges.addAll(replacedAt < 0 ? edges.size() : replacedAt, fragment.edges());
    Node replacement = fragment.nodes().getFirst();
    List<Node> nodes =
        definition.nodes().stream()
            .map(node -> node.id().equals(original.id()) ? replacement : node)
            .toList();
    return new Definition(
        definition.schemaVersion(),
        editsInputs ? fragment.inputs() : definition.inputs(),
        nodes,
        edges,
        definition.notes());
  }

  /** A fragment's second node, or its only node when that node has another ID or type. */
  private static Node unexpectedNode(List<Node> nodes) {
    if (nodes.isEmpty()) return null;
    return nodes.size() > 1 ? nodes.get(1) : nodes.getFirst();
  }

  private Build failedBuild(String source, String message, int line, int column) {
    return new Build(null, source, List.of(new Diagnostic(message, line, column)));
  }
}
