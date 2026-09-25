package dev.arc.engine.execution;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/** One execution session; nested rules share its trace, recursion guard and source-read budget. */
final class GraphExecution {
  private record Outcome(Object value, String branch) {}

  private final ExecutionPlans.Session plans;
  private final ExecutionDeadline deadline;
  private int executedSteps;
  private final RuleResolver resolver;
  private final Parameters parameters;
  private final ExecutionTrace trace;
  private final Set<String> activeRules = new HashSet<>();

  GraphExecution(
      ExecutionPlans.Session plans,
      RuleResolver resolver,
      Parameters parameters,
      ExecutionDeadline deadline,
      ExecutionTrace trace) {
    this.plans = plans;
    this.deadline = deadline;
    this.trace = trace;
    this.resolver = resolver;
    this.parameters = parameters;
  }

  int executedSteps() {
    return executedSteps;
  }

  Object run(
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      int depth) {
    if (depth > 16) throw ArcException.invalid("Rule nesting exceeds 16 levels");
    String key = ruleId + "@" + version;
    if (!activeRules.add(key)) throw ArcException.invalid("Circular rule reference: " + key);
    try {
      CompiledGraph compiled = plans.prepare(ruleId, version, definition);
      definition = compiled.definition();
      GraphPlan plan = compiled.graph();
      Node input =
          plan.order().stream()
              .filter(node -> node.type().equals("INPUT"))
              .findFirst()
              .orElseThrow();
      Map<String, Object> provided;
      try {
        provided = parameters.resolve(definition.inputs(), inputs, compiled::expression, deadline);
      } catch (ArcException error) {
        throw error.atNode(ruleId, version, input.id(), input.label());
      }
      Map<String, ExecutionScope> scopes = new HashMap<>();
      Map<String, String> branches = new HashMap<>();
      Map<String, Object> outputs = new LinkedHashMap<>();
      // Topological order resolves skipped parents too. Every active join executes once.
      for (Node node : plan.order()) {
        try {
          ExecutionScope values = incomingScope(node, plan, provided, scopes, branches);
          if (values == null) continue;
          checkStepBudget();
          executedSteps++;
          Outcome outcome = evaluate(node, values.variables(), depth, compiled);
          if (node.type().equals("OUTPUT")) outputs.put(node.id(), outcome.value());
          if (node.storesResult()) values.store(node.output(), outcome.value(), node.id());
          scopes.put(node.id(), values);
          branches.put(node.id(), outcome.branch());
          trace.add(
              new Engine.Step(
                  ruleId,
                  version,
                  node.id(),
                  node.label(),
                  node.type(),
                  outcome.value(),
                  outcome.branch(),
                  depth));
        } catch (ArcException error) {
          throw error.atNode(ruleId, version, node.id(), node.label());
        }
      }
      if (outputs.isEmpty()) throw ArcException.invalid("Execution did not reach an Output node");
      return outputs.size() == 1 ? outputs.values().iterator().next() : outputs;
    } catch (ArcException error) {
      throw error.inRule(ruleId, version);
    } finally {
      activeRules.remove(key);
    }
  }

  /** Null means that every incoming path was skipped; it is distinct from a value of null. */
  private ExecutionScope incomingScope(
      Node node,
      GraphPlan plan,
      Map<String, Object> inputs,
      Map<String, ExecutionScope> scopes,
      Map<String, String> branches) {
    if (node.type().equals("INPUT")) return ExecutionScope.inputs(inputs, node.id());
    List<ExecutionScope> activeParents = new ArrayList<>();
    for (Edge edge : plan.incoming(node.id())) {
      if (edge.sourceHandle().equals(branches.get(edge.source())))
        activeParents.add(scopes.get(edge.source()));
    }
    return activeParents.isEmpty() ? null : ExecutionScope.merge(activeParents, plan);
  }

  private Outcome evaluate(
      Node node, Map<String, Object> scope, int depth, CompiledGraph compiled) {
    return switch (node.type()) {
      case "INPUT" -> new Outcome(new LinkedHashMap<>(scope), "next");
      case "FORMULA" ->
          new Outcome(compiled.expression(node.expression()).evaluate(scope, deadline), "next");
      case "CONDITION" -> {
        boolean value =
            Expressions.bool(compiled.expression(node.expression()).evaluate(scope, deadline));
        yield new Outcome(value, Boolean.toString(value));
      }
      case "SWITCH" -> {
        String branch = "default";
        for (BranchCase option : node.cases()) {
          if (matches(option, scope, compiled)) {
            branch = "case:" + option.id();
            break;
          }
        }
        yield new Outcome(branch, branch);
      }
      case "TRANSFORM" -> new Outcome(transform(node, scope, compiled), "next");
      case "REFERENCE" -> new Outcome(reference(node, scope, depth, compiled), "next");
      case "OUTPUT" ->
          new Outcome(compiled.expression(node.expression()).evaluate(scope, deadline), null);
      default -> throw ArcException.invalid("Unknown node type");
    };
  }

  private Object transform(Node node, Map<String, Object> scope, CompiledGraph compiled) {
    if (node.fields() == null || node.fields().isEmpty())
      return compiled.expression(node.expression()).evaluate(scope, deadline);
    var transformed = new LinkedHashMap<String, Object>();
    for (Field field : node.fields()) {
      try {
        transformed.put(
            field.name(), compiled.expression(field.expression()).evaluate(scope, deadline));
      } catch (ArcException error) {
        if (error.status() == 504) throw error;
        throw ArcException.invalid("Field " + field.name() + ": " + error.getMessage());
      }
    }
    return Expressions.bounded(transformed);
  }

  private Object reference(
      Node node, Map<String, Object> scope, int depth, CompiledGraph compiled) {
    var inputs = new LinkedHashMap<String, Object>();
    if (node.bindings() != null) {
      for (var binding : node.bindings().entrySet()) {
        inputs.put(
            binding.getKey(), compiled.expression(binding.getValue()).evaluate(scope, deadline));
      }
    }
    return run(
        node.ruleId(),
        node.version(),
        resolver.resolve(node.ruleId(), node.version()),
        inputs,
        depth + 1);
  }

  private boolean matches(BranchCase option, Map<String, Object> scope, CompiledGraph compiled) {
    try {
      return Expressions.bool(compiled.expression(option.expression()).evaluate(scope, deadline));
    } catch (ArcException error) {
      if (error.status() == 504) throw error;
      throw ArcException.invalid("Case " + option.label() + ": " + error.getMessage());
    }
  }

  private void checkStepBudget() {
    deadline.check();
    if (executedSteps >= 1000) throw ArcException.invalid("Execution exceeds 1,000 steps");
  }
}
