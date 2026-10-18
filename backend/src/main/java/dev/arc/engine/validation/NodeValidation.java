package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import dev.arc.model.NodeKind.Property;
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
  record OwnedExpression(String source, String nodeLabel, String position) {
    /** A node's whole expression: its label alone names it. */
    static OwnedExpression whole(Node node) {
      return new OwnedExpression(node.expression(), node.label(), null);
    }

    static OwnedExpression at(Node node, String source, String position) {
      return new OwnedExpression(source, node.label(), position);
    }

    static OwnedExpression sourceMapping(String source, String input, String key) {
      return new OwnedExpression(source, null, ExpressionPositions.sourceMapping(input, key));
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
      if (kind.uses(Property.CASES))
        require(
            node.cases() != null && !node.cases().isEmpty(),
            node.label() + ": add at least one case");

      // Expressions first: a broken binding is reported before its pin, with or without a plan.
      for (OwnedExpression expression : expressions(node))
        check(
            expression,
            scope,
            expressions,
            resolver,
            unavailable -> unavailableAtNode(unavailable, definition));
      if (kind.uses(Property.RULE)) checkPinnedRule(node, resolver);

      if (kind.storesResult()) {
        require(
            Identifiers.isValid(node.output()), node.label() + ": provide a valid result variable");
        require(
            definition.inputs().stream().noneMatch(input -> input.name().equals(node.output())),
            node.label()
                + ": its result variable "
                + node.output()
                + " has the name of an input; choose another name");
      }
    } catch (ArcException error) {
      throw error.atNode(null, null, node.id(), node.label());
    }
  }

  /**
   * Checks an owned expression's syntax, variables and Formula calls, compiling it once per pass.
   * Value problems are prefixed with the expression's label; the deadline, which the resolver may
   * raise while a pin is prepared, keeps its message (see {@link ArcException#withContext}). A null
   * scope skips the variable check, for graphs without a scope plan; {@code unavailable} explains
   * the variables, in name order, that the expression reads outside its scope.
   */
  static Expressions.Compiled check(
      OwnedExpression expression,
      Set<String> scope,
      ExpressionCache expressions,
      RuleResolver resolver,
      Function<SortedSet<String>, String> unavailable) {
    try {
      var compiled = expressions.compile(expression.source());
      if (scope != null) {
        var unknown = new TreeSet<>(compiled.variables());
        unknown.removeAll(scope);
        if (!unknown.isEmpty()) throw ArcException.invalid(unavailable.apply(unknown));
      }
      FormulaCallValidation.validate(compiled, resolver);
      return compiled;
    } catch (ArcException error) {
      throw error.withContext(expression.label());
    }
  }

  /**
   * Why a node's expression cannot read some variables, in words that say what to do. A name that
   * no input or result variable of the graph declares is told apart from one that some step sets
   * but not every path into this node: renaming an input left its old name in every expression that
   * read it, which the scope plan alone reported as unavailable on an incoming path. A single
   * undeclared name that closely matches a declared one asks whether that one was meant ({@link
   * NameSuggestions}).
   */
  static String unavailableAtNode(SortedSet<String> unknown, Definition definition) {
    // Declaration order, which breaks ties between equally close suggestions.
    var declared = new LinkedHashSet<String>();
    for (Input input : definition.inputs()) declared.add(input.name());
    for (Node node : definition.nodes())
      if (node.storesResult() && node.resultName() != null) declared.add(node.resultName());
    var undeclared = new ArrayList<String>();
    var unset = new ArrayList<String>();
    for (String name : unknown) {
      if (declared.contains(name)) unset.add(name);
      else undeclared.add(name);
    }
    var sentences = new ArrayList<String>();
    if (undeclared.size() == 1) {
      String name = undeclared.getFirst();
      String meant = NameSuggestions.closest(name, declared);
      sentences.add(
          "uses "
              + name
              + ", which no input or result variable provides; "
              + (meant == null
                  ? "correct the name or add an input named " + name + "."
                  : "did you mean " + meant + "?"));
    } else if (!undeclared.isEmpty())
      sentences.add(
          "uses "
              + GraphValidation.listed(undeclared)
              + ", which no input or result variable provides; correct the names or add inputs"
              + " with those names.");
    if (!unset.isEmpty())
      sentences.add(
          (undeclared.isEmpty() ? "uses " : "It also uses ")
              + GraphValidation.listed(unset)
              + (unset.size() == 1 ? ", which is not set" : ", which are not set")
              + " on every path into this step; set "
              + (unset.size() == 1 ? "it" : "them")
              + " on each path that leads here.");
    return withoutFinalPeriod(String.join(" ", sentences));
  }

  /**
   * Why a source mapping cannot read some names: it reads the rule's declared inputs alone. A
   * single name that closely matches an input asks whether that input was meant.
   */
  static String unavailableToSourceMapping(SortedSet<String> unknown, Definition definition) {
    if (unknown.size() == 1) {
      var inputs = new ArrayList<String>();
      for (Input input : definition.inputs()) inputs.add(input.name());
      String meant = NameSuggestions.closest(unknown.first(), inputs);
      if (meant != null)
        return "uses "
            + unknown.first()
            + ", which is not an input of this rule; did you mean "
            + meant
            + "?";
    }
    return "uses "
        + GraphValidation.listed(new ArrayList<>(unknown))
        + (unknown.size() == 1
            ? ", which is not an input of this rule"
            : ", which are not inputs of this rule")
        + "; a source mapping reads only inputs";
  }

  /**
   * Problems end without a period, as every other validation message does, so only a question keeps
   * its mark.
   */
  private static String withoutFinalPeriod(String message) {
    return message.endsWith(".") ? message.substring(0, message.length() - 1) : message;
  }

  /**
   * The contract of a pinned rule: a published version is chosen, every input that needs a caller
   * value is bound, and every binding names one of the version's inputs.
   */
  private static void checkPinnedRule(Node node, RuleResolver resolver) {
    require(
        node.ruleId() != null && node.version() != null && node.version() > 0,
        node.label() + ": select a published rule and version");
    Definition child = resolver.resolve(node.ruleId(), node.version());
    Map<String, String> bindings = node.bindings() == null ? Map.of() : node.bindings();
    String called = node.ruleId() + " v" + node.version();
    for (Input parameter : child.inputs())
      require(
          !parameter.needsCallerValue() || bindings.containsKey(parameter.name()),
          node.label() + ": choose what to pass as " + parameter.name() + " to " + called);
    Set<String> parameters = child.inputs().stream().map(Input::name).collect(Collectors.toSet());
    for (String name : bindings.keySet())
      require(
          parameters.contains(name),
          node.label()
              + ": "
              + called
              + " has no input named "
              + name
              + "; remove what this step passes as "
              + name);
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
            OwnedExpression.at(
                node, binding.getValue(), ExpressionPositions.referenceBinding(binding.getKey())));
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
    for (Node node : pinningNodes(definition))
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

  /**
   * See {@link Validator#calledRuleIds}: every rule the definition names, in node order. A stored
   * row is read as it is, so a deletion check or a publish never answers 500 for a row of another
   * model shape: a missing input or node list, a null node, a node of a type this model does not
   * know (which keeps the pin and the expressions it carries) and a source without mappings call
   * nothing more. Every expression field is read whatever the node's type, which for a shaped row
   * is exactly what {@link #expressions} enumerates.
   */
  static Set<String> calledRuleIds(
      Definition definition, Function<String, List<Expressions.FormulaCall>> formulaCalls) {
    var ids = new LinkedHashSet<String>();
    List<Node> nodes = definition.nodes() == null ? List.of() : definition.nodes();
    for (Node node : nodes) if (node != null && node.ruleId() != null) ids.add(node.ruleId());
    var sources = new ArrayList<String>();
    if (definition.inputs() != null)
      for (Input input : definition.inputs())
        if (input != null && input.source() != null && input.source().bindings() != null)
          sources.addAll(input.source().bindings().values());
    for (Node node : nodes) if (node != null) sources.addAll(expressionTexts(node));
    for (String source : sources) for (var call : formulaCalls.apply(source)) ids.add(call.id());
    return ids;
  }

  /** Every expression text a node may hold, whatever its type; unset ones are null. */
  private static List<String> expressionTexts(Node node) {
    var texts = new ArrayList<String>();
    texts.add(node.expression());
    texts.add(node.selector());
    if (node.cases() != null)
      for (BranchCase option : node.cases()) if (option != null) texts.add(option.expression());
    if (node.fields() != null)
      for (Field field : node.fields()) if (field != null) texts.add(field.expression());
    if (node.bindings() != null) texts.addAll(node.bindings().values());
    return texts;
  }

  /**
   * The nodes that pin a rule, chosen by the {@link Property#RULE} fact rather than by kind: a new
   * kind that pins a rule is then held against the callee's deletion like a Reference.
   */
  private static List<Node> pinningNodes(Definition definition) {
    return definition.nodes().stream().filter(node -> node.kind().uses(Property.RULE)).toList();
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
