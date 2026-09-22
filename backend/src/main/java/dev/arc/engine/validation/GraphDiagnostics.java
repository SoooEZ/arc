package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.validation.Validator.Problem;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.stream.Collectors;

/** Collects navigable errors even when an incomplete graph has no executable scope plan. */
final class GraphDiagnostics {
  private final DefinitionShape documentShape;
  private final NodeValidation nodeValidation;
  private final GraphValidation graphValidation;

  GraphDiagnostics(
      DefinitionShape documentShape,
      NodeValidation nodeValidation,
      GraphValidation graphValidation) {
    this.documentShape = documentShape;
    this.nodeValidation = nodeValidation;
    this.graphValidation = graphValidation;
  }

  public List<Problem> diagnostics(Definition definition, RuleResolver resolver) {
    var problems = new LinkedHashSet<Problem>();
    try {
      documentShape.validate(definition);
    } catch (ArcException e) {
      try {
        graphValidation.plan(definition, resolver);
      } catch (ArcException located) {
        problems.add(Problem.from(located));
      }
      return new ArrayList<>(problems);
    }
    Map<String, Set<String>> scope = null;
    try {
      scope = new GraphPlan(definition).available();
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    for (Node node : definition.nodes()) {
      try {
        if (scope != null)
          nodeValidation.validate(
              definition, node, scope.getOrDefault(node.id(), Set.of()), resolver);
        else nodeValidation.syntax(node);
      } catch (ArcException e) {
        problems.add(Problem.from(e.atNode(null, null, node.id(), node.label())));
      }
    }
    Node input =
        definition.nodes().stream()
            .filter(node -> node.type().equals("INPUT"))
            .findFirst()
            .orElse(null);
    var names = definition.inputs().stream().map(Input::name).collect(Collectors.toSet());
    for (Input parameter : definition.inputs())
      if (parameter.source() != null) {
        for (var binding : parameter.source().bindings().entrySet())
          try {
            NodeValidation.expression(
                binding.getValue(), names, parameter.name() + " source / " + binding.getKey());
          } catch (ArcException e) {
            problems.add(
                Problem.from(input == null ? e : e.atNode(null, null, input.id(), input.label())));
          }
      }
    try {
      graphValidation.plan(definition, resolver);
    } catch (ArcException e) {
      problems.add(Problem.from(e));
    }
    return new ArrayList<>(problems);
  }
}
