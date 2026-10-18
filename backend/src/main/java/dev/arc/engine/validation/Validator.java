package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Coordinates draft shape, executable graph checks and editor diagnostics. */
@Component
public class Validator {
  private final DefinitionShape documentShape = new DefinitionShape();
  private final DefinitionShape graphStructure = DefinitionShape.structureOnly();
  private final NodeValidation nodeValidation = new NodeValidation();
  private final GraphValidation graphValidation =
      new GraphValidation(documentShape, nodeValidation);
  private final GraphDiagnostics graphDiagnostics = new GraphDiagnostics(graphValidation);

  /** Drafts may be incomplete; shape and size limits always apply. */
  public void shape(Definition definition) {
    documentShape.validate(definition);
  }

  /**
   * The structure a scope plan reads: node IDs and kinds, Switch case IDs, connections, and that
   * inputs have distinct names. Labels, expressions, properties, defaults, sources and identifier
   * syntax are not checked, so a draft with such a problem still reports every node's variables.
   */
  public void structure(Definition definition) {
    graphStructure.validate(definition);
  }

  /**
   * The first draft-shape violation with the element that caused it, for source-level locations.
   */
  public Optional<ShapeViolation> shapeViolation(Definition definition) {
    return documentShape.firstViolation(definition);
  }

  public void validate(Definition definition, RuleResolver resolver) {
    compile(definition, resolver);
  }

  public CompiledGraph compile(Definition definition, RuleResolver resolver) {
    return graphValidation.compile(definition, resolver);
  }

  /** One diagnostics pass: each expression compiles once and the scope plan is built once. */
  public Diagnosis diagnose(Definition definition, RuleResolver resolver) {
    return graphDiagnostics.diagnose(definition, resolver);
  }

  public static void validateFormulaCalls(Expressions.Compiled expression, RuleResolver resolver) {
    FormulaCallValidation.validate(expression, resolver);
  }

  /**
   * Shows a problem of the whole graph or of its declared inputs on the graph's Input node, as the
   * editor does. An error that already has a location, or a draft without an Input node, keeps its
   * locations.
   */
  public static ArcException onInputNode(ArcException error, Definition definition) {
    return Problems.onInputNode(error, definition);
  }

  public record Problem(String message, List<ArcException.Location> locations) {
    public static Problem from(ArcException error) {
      return new Problem(error.getMessage(), error.locations());
    }
  }

  /**
   * A diagnostics result. {@code shaped} tells whether the draft passed shape validation, which
   * later static checks need. {@code dependencies} lists the rules that the graph's well-formed
   * expressions and Reference nodes call ({@link RuleCalls}), except pins the graph checks
   * rejected: those problems are already among {@code problems}.
   */
  public record Diagnosis(
      List<Problem> problems, boolean shaped, List<RuleCalls.Dependency> dependencies) {}
}
