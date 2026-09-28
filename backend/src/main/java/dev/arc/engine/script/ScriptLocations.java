package dev.arc.engine.script;

import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import dev.arc.engine.validation.ShapeViolation;
import dev.arc.model.Definition.Input;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Where one parse declared each element it created. Draft-shape problems are reported at the
 * statement that declared the offending element. Elements are found by identity: a containing graph
 * can hold equal elements that this script did not declare.
 */
final class ScriptLocations {
  private final Map<Object, Statement> declarations = new IdentityHashMap<>();
  private final Map<Input, Statement> sources = new IdentityHashMap<>();
  private List<Statement> comments = List.of();

  /** Records the statement that created a node, case, field, connection or input. */
  void declared(Object element, Statement statement) {
    declarations.put(element, statement);
  }

  void sourced(Input input, Statement statement) {
    sources.put(input, statement);
  }

  /** The script's comments in order; a graph keeps them as notes. */
  void commented(List<Statement> comments) {
    this.comments = List.copyOf(comments);
  }

  /** The violation at the statement that declared its element, or at the start of the script. */
  SyntaxException error(ShapeViolation violation) {
    return at(violation.message(), statementOf(violation.element()));
  }

  /** A problem with an element of this script, at its statement; others start the script. */
  SyntaxException error(String message, Object element) {
    return at(message, declarations.get(element));
  }

  private static SyntaxException at(String message, Statement statement) {
    return statement == null
        ? new SyntaxException(message, 1, 1)
        : ArcScriptSyntax.error(message, statement);
  }

  private Statement statementOf(ShapeViolation.Element element) {
    return switch (element) {
      case ShapeViolation.Document document -> null;
      case ShapeViolation.Note note ->
          note.index() < comments.size() ? comments.get(note.index()) : null;
      case ShapeViolation.InputDeclaration declaration -> declarations.get(declaration.input());
      case ShapeViolation.InputSource source -> sources.get(source.input());
      case ShapeViolation.NodeDeclaration declaration -> declarations.get(declaration.node());
      case ShapeViolation.SwitchCase switchCase -> declarations.get(switchCase.option());
      case ShapeViolation.TransformField field -> declarations.get(field.field());
      case ShapeViolation.Connection connection -> declarations.get(connection.edge());
    };
  }
}
