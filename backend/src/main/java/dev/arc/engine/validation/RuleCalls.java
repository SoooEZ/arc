package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import dev.arc.model.NodeKind;
import dev.arc.model.NodeKind.Property;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.function.Function;

/**
 * The rules a definition calls, through a Reference pin or an {@code @id:version} call in a node
 * expression or an input source mapping. A graph that is validated or run reads its complete pins
 * strictly ({@link #dependencies}); a stored draft or version is read leniently ({@link
 * #calledRuleIds}, {@link #pinnedVersions}), because those reads keep the callees from deletion,
 * are stored beside every write as its callee set and list a rule's callers.
 */
public final class RuleCalls {
  private RuleCalls() {}

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

  /**
   * Rules a graph calls, including Formula calls in Input source mappings. A malformed expression
   * fails at its node, so pass only published or validated graphs.
   */
  public static List<Dependency> dependencies(Definition definition) {
    return dependencies(definition, RuleCalls::formulaCallsOf);
  }

  /**
   * Rules a graph calls: complete Reference pins in node order, then {@code @id:version} calls in
   * node order, with Input source mappings at the Input node. {@code formulaCalls} lists the calls
   * of one expression; the diagnostics pass reads them from the expressions it compiled.
   */
  static List<Dependency> dependencies(
      Definition definition, Function<String, List<Expressions.FormulaCall>> formulaCalls) {
    var dependencies = new ArrayList<Dependency>();
    for (Node node : pinningNodes(definition))
      if (node.ruleId() != null && node.version() != null)
        dependencies.add(Dependency.reference(node));
    for (Node node : definition.nodes()) {
      var owned = new ArrayList<>(NodeValidation.expressions(node));
      if (node.kind() == NodeKind.INPUT)
        for (var mappings : NodeValidation.sourceMappings(definition).values())
          owned.addAll(mappings);
      try {
        for (NodeValidation.OwnedExpression expression : owned)
          for (var call : formulaCalls.apply(expression.source()))
            dependencies.add(Dependency.formula(node, call));
      } catch (ArcException error) {
        throw error.atNode(null, null, node.id(), node.label());
      }
    }
    return List.copyOf(dependencies);
  }

  /**
   * The IDs of every rule a stored draft or version names: each well-formed {@code @id:version}
   * call in any node or input source mapping, and each Reference's rule with or without a version.
   * Unlike {@link #dependencies}, an unfinished draft counts in full: a Reference may have chosen
   * its rule before its version, source mappings call rules even while the draft has no Input node,
   * and a malformed expression calls nothing instead of failing. A stored row of another model
   * shape (an unknown node type, a missing list, a source without mappings) is read as it is.
   */
  public static Set<String> calledRuleIds(Definition definition) {
    var ids = new LinkedHashSet<String>();
    for (NamedCall call : namedCalls(definition)) ids.add(call.ruleId());
    return ids;
  }

  /**
   * The versions of {@code ruleId} that a stored draft or version pins, read as leniently as {@link
   * #calledRuleIds}: each Reference's version and each well-formed {@code @id:version} call. A
   * Reference that has chosen the rule but not yet its version names the rule and pins none.
   */
  public static SortedSet<Integer> pinnedVersions(Definition definition, String ruleId) {
    var versions = new TreeSet<Integer>();
    for (var call : namedCalls(definition))
      if (call.ruleId().equals(ruleId) && call.version() != null) versions.add(call.version());
    return versions;
  }

  /**
   * A rule that a stored definition names: a node's pinned rule with its version, null while a
   * Reference has chosen the rule but not its version, or an {@code @id:version} call.
   */
  private record NamedCall(String ruleId, Integer version) {}

  /**
   * Every rule the definition names: node pins in node order, then the calls of the Input source
   * mappings and of the nodes' expressions. A stored row is read as it is, so a deletion check or a
   * publish never answers 500 for a row of another model shape: a missing input or node list, a
   * null node, a node of a type this model does not know (which keeps the pin and the expressions
   * it carries) and a source without mappings call nothing more. Each node's texts are {@link
   * Node#expressionTexts}, read whatever its type; for a shaped row they include everything {@link
   * NodeValidation#expressions} enumerates, which a test checks for every kind.
   */
  private static List<NamedCall> namedCalls(Definition definition) {
    var calls = new ArrayList<NamedCall>();
    List<Node> nodes = definition.nodes() == null ? List.of() : definition.nodes();
    for (Node node : nodes)
      if (node != null && node.ruleId() != null)
        calls.add(new NamedCall(node.ruleId(), node.version()));
    var sources = new ArrayList<String>();
    if (definition.inputs() != null)
      for (Input input : definition.inputs())
        if (input != null && input.source() != null && input.source().bindings() != null)
          sources.addAll(input.source().bindings().values());
    for (Node node : nodes) if (node != null) sources.addAll(node.expressionTexts());
    for (String source : sources)
      for (var call : wellFormedFormulaCalls(source))
        calls.add(new NamedCall(call.id(), call.version()));
    return calls;
  }

  /**
   * The nodes that pin a rule, chosen by the {@link Property#RULE} fact rather than by kind: a new
   * kind that pins a rule is then held against the callee's deletion like a Reference.
   */
  private static List<Node> pinningNodes(Definition definition) {
    return definition.nodes().stream().filter(node -> node.kind().uses(Property.RULE)).toList();
  }

  /** Calls of one expression; a malformed expression fails, located at its node by the caller. */
  private static List<Expressions.FormulaCall> formulaCallsOf(String source) {
    return source == null || !source.contains("@")
        ? List.of()
        : Expressions.compile(source).formulaCalls();
  }

  /** Calls of one stored expression; a malformed one, in an unfinished draft, calls nothing. */
  private static List<Expressions.FormulaCall> wellFormedFormulaCalls(String source) {
    try {
      return formulaCallsOf(source);
    } catch (ArcException malformed) {
      return List.of();
    }
  }
}
