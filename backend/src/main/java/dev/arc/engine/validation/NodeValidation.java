package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Node contracts and the expressions they own, shared by execution checks and editor diagnostics.
 */
final class NodeValidation {
  private record NodeExpression(String source, String label, String bindingName) {
    NodeExpression(String source, String label) {
      this(source, label, null);
    }
  }

  void validate(Definition definition, Node node, Set<String> scope, RuleResolver resolver) {
    validate(definition, node, scope, resolver, new HashMap<>());
  }

  void validate(
      Definition definition,
      Node node,
      Set<String> scope,
      RuleResolver resolver,
      Map<String, Expressions.Compiled> compiled) {
    try {
      if (node.type().equals("SWITCH"))
        require(
            node.cases() != null && !node.cases().isEmpty(),
            node.label() + ": add at least one case");

      Set<String> referenceParameters = Set.of();
      if (node.type().equals("REFERENCE"))
        referenceParameters = referenceParameters(node, resolver);

      for (NodeExpression expression : expressions(node)) {
        if (expression.bindingName() != null) {
          if (!node.type().equals("REFERENCE")) continue;
          require(
              referenceParameters.contains(expression.bindingName()),
              node.label() + ": unknown parameter " + expression.bindingName());
        }
        expression(expression.source(), scope, expression.label(), compiled);
      }

      if (node.storesResult()) {
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

  /** A cyclic/incomplete graph may have no scope plan; its expressions can still be parsed. */
  void syntax(Node node) {
    for (NodeExpression expression : expressions(node)) Expressions.compile(expression.source());
  }

  Set<String> handles(Node node) {
    if (node.type().equals("OUTPUT")) return Set.of();
    if (node.type().equals("CONDITION")) return Set.of("true", "false");
    if (node.type().equals("SWITCH")) {
      var handles = new LinkedHashSet<String>();
      if (node.cases() != null)
        for (BranchCase option : node.cases()) handles.add("case:" + option.id());
      handles.add("default");
      return handles;
    }
    return Set.of("next");
  }

  static Expressions.Compiled expression(String source, Set<String> scope, String label) {
    return expression(source, scope, label, new HashMap<>());
  }

  static Expressions.Compiled expression(
      String source,
      Set<String> scope,
      String label,
      Map<String, Expressions.Compiled> expressions) {
    try {
      var compiled = expressions.computeIfAbsent(source, Expressions::compile);
      var unknown = new TreeSet<>(compiled.variables());
      unknown.removeAll(scope);
      require(
          unknown.isEmpty(),
          "Variables unavailable on every incoming path: " + String.join(", ", unknown));
      return compiled;
    } catch (ArcException error) {
      throw ArcException.invalid(label + ": " + error.getMessage());
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

  private List<NodeExpression> expressions(Node node) {
    var expressions = new ArrayList<NodeExpression>();
    if (Set.of("FORMULA", "CONDITION", "OUTPUT").contains(node.type()))
      expressions.add(new NodeExpression(node.expression(), node.label()));
    // Draft shape permits unused bindings. Syntax diagnostics retain them, while
    // executable validation uses bindings only for Reference nodes.
    if (node.bindings() != null)
      for (var binding : node.bindings().entrySet())
        expressions.add(
            new NodeExpression(
                binding.getValue(), node.label() + " / " + binding.getKey(), binding.getKey()));
    if (node.cases() != null)
      for (BranchCase option : node.cases())
        expressions.add(
            new NodeExpression(option.expression(), node.label() + " / Case " + option.label()));
    if (node.fields() != null)
      for (Field field : node.fields())
        expressions.add(
            new NodeExpression(field.expression(), node.label() + " / Field " + field.name()));
    if (node.type().equals("TRANSFORM") && (node.fields() == null || node.fields().isEmpty()))
      expressions.add(new NodeExpression(node.expression(), node.label()));
    return expressions;
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
