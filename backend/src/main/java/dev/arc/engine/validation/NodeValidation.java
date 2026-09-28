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
   * An expression and the label its problems carry, such as {@code "Route / Case Premium"}. The
   * enumerations below are the only places that name an expression's position, so every check
   * reports one fault with the same text.
   */
  record OwnedExpression(String source, String label, String bindingName) {
    OwnedExpression(String source, String label) {
      this(source, label, null);
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

      Set<String> referenceParameters = Set.of();
      if (kind == NodeKind.REFERENCE) referenceParameters = referenceParameters(node, resolver);

      for (OwnedExpression expression : expressions(node)) {
        if (expression.bindingName() != null)
          require(
              referenceParameters.contains(expression.bindingName()),
              node.label() + ": unknown parameter " + expression.bindingName());
        check(expression, scope, expressions, resolver);
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
   * A cyclic graph has no scope plan. Its expressions still receive syntax and Formula checks,
   * labelled like executable validation labels them.
   */
  void syntax(Node node, RuleResolver resolver, ExpressionCache expressions) {
    try {
      for (OwnedExpression expression : expressions(node))
        check(expression, null, expressions, resolver);
    } catch (ArcException error) {
      throw error.atNode(null, null, node.id(), node.label());
    }
  }

  /**
   * Checks an owned expression's syntax, variables and Formula calls, compiling it once per pass.
   * Problems are prefixed with the expression's label. A null scope skips the variable check, for
   * graphs without a scope plan.
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
          !parameter.required()
              || parameter.defaultValue() != null
              || parameter.source() != null
              || bindings.containsKey(parameter.name()),
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
    return new OwnedExpression(node.expression(), node.label());
  }

  private static List<OwnedExpression> selector(Node node) {
    if (node.selector() == null) return List.of();
    return List.of(new OwnedExpression(node.selector(), node.label() + " / Selector"));
  }

  private static List<OwnedExpression> bindings(Node node) {
    var bindings = new ArrayList<OwnedExpression>();
    if (node.bindings() != null)
      for (var binding : node.bindings().entrySet())
        bindings.add(
            new OwnedExpression(
                binding.getValue(), node.label() + " / " + binding.getKey(), binding.getKey()));
    return bindings;
  }

  private static List<OwnedExpression> cases(Node node) {
    var cases = new ArrayList<OwnedExpression>();
    if (node.cases() != null)
      for (BranchCase option : node.cases())
        cases.add(
            new OwnedExpression(option.expression(), node.label() + " / Case " + option.label()));
    return cases;
  }

  /** A Transform's field expressions, or its whole-value expression when it maps no fields. */
  private static List<OwnedExpression> mapping(Node node) {
    if (node.fields() == null || node.fields().isEmpty()) return List.of(whole(node));
    var fields = new ArrayList<OwnedExpression>();
    for (Field field : node.fields())
      fields.add(
          new OwnedExpression(field.expression(), node.label() + " / Field " + field.name()));
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
            new OwnedExpression(
                mapping.getValue(), input.name() + " source / " + mapping.getKey()));
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
