package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Node contracts and the expressions they own, shared by execution checks and editor diagnostics.
 */
final class NodeValidation {
  /**
   * An expression, the node that owns it and its position in that node ({@link
   * ExpressionPositions}); a source mapping has a position and no node. The enumerations below are
   * the only places that build these, so every check reports one fault with the same label, such as
   * {@code "Route / Case Premium"} or {@code "rate source / region"}.
   */
  record OwnedExpression(String source, String nodeLabel, String position, String bindingName) {
    /** A node's whole expression: its label alone names it. */
    static OwnedExpression whole(Node node) {
      return new OwnedExpression(node.expression(), node.label(), null, null);
    }

    static OwnedExpression at(Node node, String source, String position) {
      return new OwnedExpression(source, node.label(), position, null);
    }

    static OwnedExpression sourceMapping(String source, String input, String key) {
      return new OwnedExpression(source, null, ExpressionPositions.sourceMapping(input, key), null);
    }

    /** The label its problems carry. */
    String label() {
      if (position == null) return nodeLabel;
      if (nodeLabel == null) return position;
      return nodeLabel + " / " + position;
    }
  }

  void validate(
      Definition definition,
      Node node,
      Set<String> scope,
      RuleResolver resolver,
      ExpressionCache expressions) {
    try {
      NodeKind kind = node.kind();
      if (kind == NodeKind.SWITCH)
        require(
            node.cases() != null && !node.cases().isEmpty(),
            node.label() + ": add at least one case");

      // Expressions first: a broken binding is reported before its pin, with or without a plan.
      for (OwnedExpression expression : expressions(node))
        check(expression, scope, expressions, resolver);
      if (kind == NodeKind.REFERENCE) {
        Set<String> referenceParameters = referenceParameters(node, resolver);
        for (OwnedExpression expression : expressions(node))
          if (expression.bindingName() != null)
            require(
                referenceParameters.contains(expression.bindingName()),
                node.label() + ": unknown parameter " + expression.bindingName());
      }

      if (kind.storesResult()) {
        require(
            Identifiers.isValid(node.output()), node.label() + ": provide a valid result variable");
        require(
            definition.inputs().stream().noneMatch(input -> input.name().equals(node.output())),
            node.label() + ": cannot overwrite input " + node.output());
      }
    } catch (ArcException error) {
      throw error.atNode(null, null, node.id(), node.label());
    }
  }

  /**
   * Checks an owned expression's syntax, variables and Formula calls, compiling it once per pass.
   * Value problems are prefixed with the expression's label; the deadline, which the resolver may
   * raise while a pin is prepared, keeps its message (see {@link ArcException#withContext}). A null
   * scope skips the variable check, for graphs without a scope plan.
   */
  static Expressions.Compiled check(
      OwnedExpression expression,
      Set<String> scope,
      ExpressionCache expressions,
      RuleResolver resolver) {
    try {
      var compiled = expressions.compile(expression.source());
      if (scope != null) {
        var unknown = new TreeSet<>(compiled.variables());
        unknown.removeAll(scope);
        require(
            unknown.isEmpty(),
            "Variables unavailable on every incoming path: " + String.join(", ", unknown));
      }
      FormulaCallValidation.validate(compiled, resolver);
      return compiled;
    } catch (ArcException error) {
      throw error.withContext(expression.label());
    }
  }

  private Set<String> referenceParameters(Node node, RuleResolver resolver) {
    require(
        node.ruleId() != null && node.version() != null && node.version() > 0,
        node.label() + ": select a published rule and version");
    Definition child = resolver.resolve(node.ruleId(), node.version());
    Map<String, String> bindings = node.bindings() == null ? Map.of() : node.bindings();
    for (Input parameter : child.inputs())
      require(
          !parameter.needsCallerValue() || bindings.containsKey(parameter.name()),
          node.label() + ": missing binding for " + parameter.name());
    return child.inputs().stream().map(Input::name).collect(Collectors.toSet());
  }

  /**
   * The expressions a node holds, in the order checks visit them. Draft shape rejects properties
   * that the node's kind does not use, so these are all of them.
   */
  static List<OwnedExpression> expressions(Node node) {
    return switch (node.kind()) {
      case FORMULA, CONDITION, OUTPUT -> List.of(whole(node));
      case SWITCH -> join(selector(node), cases(node));
      case TRANSFORM -> mapping(node);
      case REFERENCE -> bindings(node);
      case INPUT -> List.of();
    };
  }

  private static OwnedExpression whole(Node node) {
    return OwnedExpression.whole(node);
  }

  private static List<OwnedExpression> selector(Node node) {
    if (node.selector() == null) return List.of();
    return List.of(OwnedExpression.at(node, node.selector(), ExpressionPositions.SELECTOR));
  }

  private static List<OwnedExpression> bindings(Node node) {
    var bindings = new ArrayList<OwnedExpression>();
    if (node.bindings() != null)
      for (var binding : node.bindings().entrySet())
        bindings.add(
            new OwnedExpression(
                binding.getValue(),
                node.label(),
                ExpressionPositions.referenceBinding(binding.getKey()),
                binding.getKey()));
    return bindings;
  }

  private static List<OwnedExpression> cases(Node node) {
    var cases = new ArrayList<OwnedExpression>();
    if (node.cases() != null)
      for (BranchCase option : node.cases())
        cases.add(
            OwnedExpression.at(node, option.expression(), ExpressionPositions.switchCase(option)));
    return cases;
  }

  /** A Transform's field expressions, or its whole-value expression when it maps no fields. */
  private static List<OwnedExpression> mapping(Node node) {
    if (node.fields() == null || node.fields().isEmpty()) return List.of(whole(node));
    var fields = new ArrayList<OwnedExpression>();
    for (Field field : node.fields())
      fields.add(
          OwnedExpression.at(node, field.expression(), ExpressionPositions.transformField(field)));
    return fields;
  }

  @SafeVarargs
  private static List<OwnedExpression> join(List<OwnedExpression>... parts) {
    var joined = new ArrayList<OwnedExpression>();
    for (List<OwnedExpression> part : parts) joined.addAll(part);
    return joined;
  }

  /**
   * Source mappings by input, in declaration order. The Input node owns them; they read the
   * declared inputs rather than a graph scope.
   */
  static Map<String, List<OwnedExpression>> sourceMappings(Definition definition) {
    var mappings = new LinkedHashMap<String, List<OwnedExpression>>();
    for (Input input : definition.inputs()) {
      if (input.source() == null) continue;
      var owned = new ArrayList<OwnedExpression>();
      for (var mapping : input.source().bindings().entrySet())
        owned.add(
            OwnedExpression.sourceMapping(mapping.getValue(), input.name(), mapping.getKey()));
      mappings.put(input.name(), owned);
    }
    return mappings;
  }

  /**
   * Rules a graph calls: complete Reference pins in node order, then {@code @id:version} calls in
   * node order, with Input source mappings at the Input node. {@code formulaCalls} lists the calls
   * of one expression.
   */
  static List<Validator.Dependency> dependencies(
      Definition definition, Function<String, List<Expressions.FormulaCall>> formulaCalls) {
    var dependencies = new ArrayList<Validator.Dependency>();
    for (Node node : definition.nodesOf(NodeKind.REFERENCE))
      if (node.ruleId() != null && node.version() != null)
        dependencies.add(Validator.Dependency.reference(node));
    for (Node node : definition.nodes()) {
      var owned = new ArrayList<>(expressions(node));
      if (node.kind() == NodeKind.INPUT)
        for (var mappings : sourceMappings(definition).values()) owned.addAll(mappings);
      try {
        for (OwnedExpression expression : owned)
          for (var call : formulaCalls.apply(expression.source()))
            dependencies.add(Validator.Dependency.formula(node, call));
      } catch (ArcException error) {
        throw error.atNode(null, null, node.id(), node.label());
      }
    }
    return List.copyOf(dependencies);
  }

  /** See {@link Validator#calledRuleIds}: every rule the definition names, in node order. */
  static Set<String> calledRuleIds(
      Definition definition, Function<String, List<Expressions.FormulaCall>> formulaCalls) {
    var ids = new LinkedHashSet<String>();
    for (Node node : definition.nodesOf(NodeKind.REFERENCE))
      if (node.ruleId() != null) ids.add(node.ruleId());
    var owned = new ArrayList<OwnedExpression>();
    for (var mappings : sourceMappings(definition).values()) owned.addAll(mappings);
    for (Node node : definition.nodes()) owned.addAll(expressions(node));
    for (OwnedExpression expression : owned)
      for (var call : formulaCalls.apply(expression.source())) ids.add(call.id());
    return ids;
  }

  /** Calls of one expression; a malformed expression fails, located at its node by the caller. */
  static List<Expressions.FormulaCall> formulaCallsOf(String source) {
    return source == null || !source.contains("@")
        ? List.of()
        : Expressions.compile(source).formulaCalls();
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
