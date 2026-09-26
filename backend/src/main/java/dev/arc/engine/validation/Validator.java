package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.util.List;
import org.springframework.stereotype.Component;

/** Coordinates draft shape, executable graph checks and editor diagnostics. */
@Component
public class Validator {
  private final DefinitionShape documentShape = new DefinitionShape();
  private final NodeValidation nodeValidation = new NodeValidation();
  private final GraphValidation graphValidation =
      new GraphValidation(documentShape, nodeValidation);
  private final GraphDiagnostics graphDiagnostics =
      new GraphDiagnostics(documentShape, nodeValidation, graphValidation);

  /** Drafts may be incomplete; shape and size limits always apply. */
  public void shape(Definition definition) {
    documentShape.validate(definition);
  }

  public void validate(Definition definition, RuleResolver resolver) {
    plan(definition, resolver);
  }

  public GraphPlan plan(Definition definition, RuleResolver resolver) {
    return compile(definition, resolver).graph();
  }

  public CompiledGraph compile(Definition definition, RuleResolver resolver) {
    return graphValidation.compile(definition, resolver);
  }

  public List<Problem> diagnostics(Definition definition, RuleResolver resolver) {
    return graphDiagnostics.diagnostics(definition, resolver);
  }

  public record FormulaReference(String nodeId, String label, Expressions.FormulaCall call) {}

  /** Calls owned by executable expressions, including source bindings on the Input node. */
  public static List<FormulaReference> formulaReferences(Definition definition) {
    return NodeValidation.formulaReferences(definition);
  }

  public static void validateFormulaCalls(Expressions.Compiled expression, RuleResolver resolver) {
    FormulaCallValidation.validate(expression, resolver);
  }

  public record Problem(String message, List<ArcException.Location> locations) {
    public static Problem from(ArcException error) {
      return new Problem(error.getMessage(), error.locations());
    }
  }
}
