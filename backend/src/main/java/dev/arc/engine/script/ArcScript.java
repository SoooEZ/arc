package dev.arc.engine.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Studio boundary: build and render graphs without evaluating expressions or fetching data. */
@Component
public class ArcScript {
  private final Validator validator;
  private final ArcScriptParser parser;
  private final ArcScriptRenderer renderer;

  public record Diagnostic(String message, int line, int column) {}

  public record Build(Definition definition, String source, List<Diagnostic> diagnostics) {}

  public record ExpressionCheck(
      boolean valid,
      Set<String> variables,
      String error,
      List<Expressions.FormulaCall> formulaCalls) {}

  public ArcScript(ObjectMapper json, Validator validator) {
    this.validator = validator;
    this.parser = new ArcScriptParser(json);
    this.renderer = new ArcScriptRenderer(json);
  }

  /** Syntax and dependencies only; runtime type errors still require execution. */
  public ExpressionCheck checkExpression(String expression) {
    try {
      var compiled = Expressions.compile(expression);
      return new ExpressionCheck(true, compiled.variables(), null, compiled.formulaCalls());
    } catch (ArcException failure) {
      return new ExpressionCheck(false, Set.of(), failure.getMessage(), List.of());
    }
  }

  public Build build(String source) {
    try {
      Definition definition = parse(source);
      return new Build(definition, render(definition), List.of());
    } catch (SyntaxException failure) {
      return failedBuild(source, failure.getMessage(), failure.line, failure.column);
    } catch (ArcException failure) {
      return failedBuild(source, failure.getMessage(), 1, 1);
    }
  }

  public Definition parse(String source) {
    return parser.parse(source);
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

  public Build buildNode(Definition definition, String nodeId, String source) {
    try {
      validator.shape(definition);
      Node original = findNode(definition, nodeId);
      Definition fragment = parse(source);
      Definition merged = replaceNode(definition, original, fragment);
      return new Build(merged, renderNode(merged, nodeId), List.of());
    } catch (SyntaxException failure) {
      return failedBuild(source, failure.getMessage(), failure.line, failure.column);
    } catch (ArcException failure) {
      return failedBuild(source, failure.getMessage(), 1, 1);
    }
  }

  private Node findNode(Definition definition, String nodeId) {
    return definition.nodes().stream()
        .filter(node -> node.id().equals(nodeId))
        .findFirst()
        .orElseThrow(() -> ArcException.invalid("Node not found"));
  }

  private Definition replaceNode(Definition definition, Node original, Definition fragment) {
    if (fragment.nodes().size() != 1
        || !fragment.nodes().getFirst().id().equals(original.id())
        || !fragment.nodes().getFirst().type().equals(original.type())) {
      throw ArcException.invalid(
          "Keep exactly this node, with the same ID and type. Use Code studio to edit the whole"
              + " graph.");
    }
    boolean editsInputs = original.type().equals("INPUT");
    if (!editsInputs && !fragment.inputs().isEmpty()) {
      throw ArcException.invalid("Edit parameters in the Input node.");
    }

    // A fragment owns only its node and outgoing edges. Incoming edges and notes
    // belong to the containing graph; an Input fragment also owns its parameters.
    var edges = new ArrayList<Edge>();
    for (Edge edge : definition.edges()) {
      if (!edge.source().equals(original.id())) edges.add(edge);
    }
    edges.addAll(fragment.edges());
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

  private Build failedBuild(String source, String message, int line, int column) {
    return new Build(null, source, List.of(new Diagnostic(message, line, column)));
  }
}
