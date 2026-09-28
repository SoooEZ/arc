package dev.arc.engine.validation;

import dev.arc.model.Definition.BranchCase;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Field;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;

/**
 * The first draft-shape rule a definition breaks, and the element that breaks it. Validation shows
 * the problem on the element's node; ARC Script points at the statement that declared the element.
 */
public record ShapeViolation(String message, Element element) {
  /** A definition element that draft-shape rules apply to. */
  public sealed interface Element
      permits Document,
          Note,
          InputDeclaration,
          InputSource,
          NodeDeclaration,
          SwitchCase,
          TransformField,
          Connection {}

  /** The document as a whole, such as its schema version or node count. */
  public record Document() implements Element {}

  /** A graph note by its position in {@code notes}. */
  public record Note(int index) implements Element {}

  /** An input's name, type and default value. */
  public record InputDeclaration(Input input) implements Element {}

  /** An input's data-source binding. */
  public record InputSource(Input input) implements Element {}

  /** A node's ID, label, position, expressions, names, rule pin and bindings. */
  public record NodeDeclaration(Node node) implements Element {}

  /** One case of a Switch node. */
  public record SwitchCase(Node node, BranchCase option) implements Element {}

  /** One field of a Transform node. */
  public record TransformField(Node node, Field field) implements Element {}

  /** One connection; it belongs to the node it leaves. */
  public record Connection(Edge edge) implements Element {}
}
