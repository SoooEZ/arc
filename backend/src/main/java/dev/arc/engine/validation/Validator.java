package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Node;
import java.util.List;
import java.util.Optional;
import java.util.Set;
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

  /**
   * The first draft-shape violation with the element that caused it, for source-level locations.
   */
  public Optional<ShapeViolation> shapeViolation(Definition definition) {
    return documentShape.firstViolation(definition);
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
    return diagnose(definition, resolver).problems();
  }

  /** One diagnostics pass: each expression compiles once and the scope plan is built once. */
  public Diagnosis diagnose(Definition definition, RuleResolver resolver) {
    return graphDiagnostics.diagnose(definition, resolver);
  }

  /**
   * Rules a graph calls, including Formula calls in Input source mappings. A malformed expression
   * fails at its node, so pass only published or validated graphs.
   */
  public static List<Dependency> dependencies(Definition definition) {
    return NodeValidation.dependencies(definition, NodeValidation::formulaCallsOf);
  }

  /**
   * The IDs of every rule a stored draft or version names: each well-formed {@code @id:version}
   * call in any node or input source mapping, and each Reference's rule with or without a version.
   * Unlike {@link #dependencies}, an unfinished draft counts in full: a Reference may have chosen
   * its rule before its version, source mappings call rules even while the draft has no Input node,
   * and a malformed expression calls nothing instead of failing.
   */
  public static Set<String> calledRuleIds(Definition definition) {
    return NodeValidation.calledRuleIds(definition, Validator::wellFormedFormulaCalls);
  }

  private static List<Expressions.FormulaCall> wellFormedFormulaCalls(String source) {
    try {
      return NodeValidation.formulaCallsOf(source);
    } catch (ArcException malformed) {
      return List.of();
    }
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
   * expressions and Reference nodes call, except pins the graph checks rejected: those problems are
   * already among {@code problems}.
   */
  public record Diagnosis(List<Problem> problems, boolean shaped, List<Dependency> dependencies) {}

  /** A published rule that a node calls, through a Reference or an {@code @id:version} call. */
  public record Dependency(String nodeId, String label, String ruleId, int version, Call call) {
    public enum Call {
      REFERENCE,
      FORMULA
    }

    static Dependency reference(Node node) {
      return new Dependency(node.id(), node.label(), node.ruleId(), node.version(), Call.REFERENCE);
    }

    static Dependency formula(Node node, Expressions.FormulaCall call) {
      return new Dependency(node.id(), node.label(), call.id(), call.version(), Call.FORMULA);
    }

    /** Resolves the pin as execution does: a direct call must reach a published Formula. */
    public Definition resolve(RuleResolver resolver) {
      return call == Call.FORMULA
          ? resolver.resolveFormula(ruleId, version)
          : resolver.resolve(ruleId, version);
    }
  }
}
