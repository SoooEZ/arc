package dev.arc.engine.execution;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import java.util.*;
import java.util.function.Supplier;

/** One execution session; nested rules share its trace, recursion guard and source-read budget. */
final class GraphExecution {
  private record Outcome(Object value, String branch) {}

  private record ReachedOutput(Node node, Object value) {}

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

  /**
   * Runs one rule invocation. A pinned definition is read only when this session and the plan cache
   * have not compiled that version yet.
   */
  Object run(
      String ruleId,
      Integer version,
      Supplier<Definition> definition,
      Map<String, Object> inputs,
      int depth) {
    if (depth > Limits.MAX_NESTING_DEPTH)
      throw ArcException.limit("Rule nesting exceeds " + Limits.MAX_NESTING_DEPTH + " levels");
    String key = ruleId + "@" + version;
    if (!activeRules.add(key)) throw ArcException.invalid("Circular rule reference: " + key);
    try {
      CompiledGraph compiled = prepare(ruleId, version, definition);
      return new RuleRun(ruleId, version, compiled, depth).execute(inputs);
    } catch (ArcException error) {
      throw error.inRule(ruleId, version);
    } finally {
      activeRules.remove(key);
    }
  }

  /**
   * The compiled plan of a draft or pinned version. Its failure, in draft shape or compilation, is
   * the definition's and never a value error, so the caller's fallbacks let it through (lesson B7).
   */
  private CompiledGraph prepare(String ruleId, Integer version, Supplier<Definition> definition) {
    try {
      return plans.prepare(ruleId, version, definition);
    } catch (ArcException error) {
      throw error.asDefinitionFailure();
    }
  }

  /** Reads a pin; a missing version or a rule that is not a Formula fails the definition too. */
  private static Definition pinned(Supplier<Definition> read) {
    try {
      return read.get();
    } catch (ArcException error) {
      throw error.asDefinitionFailure();
    }
  }

  /** One rule invocation: its compiled graph and depth, and the nodes executed so far. */
  private final class RuleRun {
    private final String ruleId;
    private final Integer version;
    private final CompiledGraph compiled;
    private final GraphPlan plan;
    private final int depth;
    private final Expressions.FormulaCaller formulas = this::callFormula;
    private final Map<String, ExecutionScope> scopes = new HashMap<>();
    private final Map<String, String> branches = new HashMap<>();
    private final Map<String, ReachedOutput> outputs = new LinkedHashMap<>();

    RuleRun(String ruleId, Integer version, CompiledGraph compiled, int depth) {
      this.ruleId = ruleId;
      this.version = version;
      this.compiled = compiled;
      this.plan = compiled.graph();
      this.depth = depth;
    }

    Object execute(Map<String, Object> callerInputs) {
      ExecutionScope inputs = resolveInputs(callerInputs);
      // Topological order resolves skipped parents too. Every active join executes once.
      for (Node node : plan.order()) {
        try {
          ExecutionScope scope = node.kind() == NodeKind.INPUT ? inputs : incomingScope(node);
          if (scope != null) runNode(node, scope);
        } catch (ArcException error) {
          throw error.atNode(ruleId, version, node.id(), node.label());
        }
      }
      return result();
    }

    private ExecutionScope resolveInputs(Map<String, Object> callerInputs) {
      Node input = compiled.definition().inputNode().orElseThrow();
      try {
        var resolved =
            parameters.resolve(
                compiled.definition().inputs(),
                callerInputs,
                compiled::expression,
                deadline,
                formulas);
        return ExecutionScope.inputs(resolved, input.id());
      } catch (ArcException error) {
        throw error.atNode(ruleId, version, input.id(), input.label());
      }
    }

    /** Null means that every incoming path was skipped; it is distinct from a value of null. */
    private ExecutionScope incomingScope(Node node) {
      List<ExecutionScope> active = new ArrayList<>();
      for (Edge edge : plan.incoming(node.id())) {
        if (!edge.sourceHandle().equals(branches.get(edge.source()))) continue;
        // A parent without a result passes its own parent's scope on, so scopes can repeat.
        ExecutionScope parent = scopes.get(edge.source());
        if (!active.contains(parent)) active.add(parent);
      }
      return active.isEmpty() ? null : ExecutionScope.join(active);
    }

    private void runNode(Node node, ExecutionScope scope) {
      checkStepBudget();
      executedSteps++;
      Outcome outcome = evaluate(node, scope.variables());
      Object traceValue = outcome.value();
      if (node.kind() == NodeKind.OUTPUT) traceValue = reachOutput(node, outcome.value());
      ExecutionScope outgoing =
          node.storesResult() ? scope.withResult(node.output(), outcome.value(), node.id()) : scope;
      scopes.put(node.id(), outgoing);
      branches.put(node.id(), outcome.branch());
      trace.add(
          new Engine.Step(
              ruleId,
              version,
              node.id(),
              node.label(),
              node.type(),
              traceValue,
              outcome.branch(),
              depth));
    }

    private Outcome evaluate(Node node, Map<String, Object> scope) {
      return switch (node.kind()) {
        case INPUT -> new Outcome(new LinkedHashMap<>(scope), Handles.NEXT);
        case FORMULA -> new Outcome(eval(node.expression(), scope), Handles.NEXT);
        case CONDITION -> {
          boolean value = Expressions.bool(eval(node.expression(), scope));
          yield new Outcome(value, Handles.condition(value));
        }
        case SWITCH -> {
          String branch = switchBranch(node, scope);
          yield new Outcome(branch, branch);
        }
        case TRANSFORM -> new Outcome(transform(node, scope), Handles.NEXT);
        case REFERENCE -> new Outcome(reference(node, scope), Handles.NEXT);
        case OUTPUT -> new Outcome(eval(node.expression(), scope), null);
      };
    }

    private Object eval(String expression, Map<String, Object> scope) {
      return compiled.expression(expression).evaluate(scope, deadline, formulas);
    }

    /** Without a selector the first true case wins; otherwise the first case equal to it. */
    private String switchBranch(Node node, Map<String, Object> scope) {
      Object selector = node.selector() == null ? null : selector(node, scope);
      for (BranchCase option : node.cases())
        if (matches(option, selector, scope)) return Handles.forCase(option.id());
      return Handles.DEFAULT;
    }

    private Object selector(Node node, Map<String, Object> scope) {
      try {
        return switchValue(eval(node.selector(), scope));
      } catch (ArcException error) {
        throw inContext(error, "Selector");
      }
    }

    private boolean matches(BranchCase option, Object selector, Map<String, Object> scope) {
      try {
        Object value = eval(option.expression(), scope);
        return selector == null
            ? Expressions.bool(value)
            : Expressions.equal(selector, switchValue(value));
      } catch (ArcException error) {
        throw inContext(error, "Case " + option.label());
      }
    }

    private Object transform(Node node, Map<String, Object> scope) {
      if (node.fields() == null || node.fields().isEmpty()) return eval(node.expression(), scope);
      var transformed = new LinkedHashMap<String, Object>();
      for (Field field : node.fields()) {
        try {
          transformed.put(field.name(), eval(field.expression(), scope));
        } catch (ArcException error) {
          throw inContext(error, "Field " + field.name());
        }
      }
      return Expressions.bounded(transformed);
    }

    private Object reference(Node node, Map<String, Object> scope) {
      var inputs = new LinkedHashMap<String, Object>();
      if (node.bindings() != null) {
        for (var binding : node.bindings().entrySet())
          inputs.put(binding.getKey(), eval(binding.getValue(), scope));
      }
      Definition child = pinned(() -> resolver.resolve(node.ruleId(), node.version()));
      return run(node.ruleId(), node.version(), () -> child, inputs, depth + 1);
    }

    private Object callFormula(Expressions.FormulaCall call, List<Object> arguments) {
      try {
        deadline.check();
        Definition child = pinned(() -> resolver.resolveFormula(call.id(), call.version()));
        if (arguments.size() > child.inputs().size())
          throw ArcException.invalid("Too many arguments for @" + call.id() + ":" + call.version());
        var inputs = new LinkedHashMap<String, Object>();
        for (int index = 0; index < arguments.size(); index++)
          inputs.put(child.inputs().get(index).name(), arguments.get(index));
        return run(call.id(), call.version(), () -> child, inputs, depth + 1);
      } catch (ArcException error) {
        if (error.locations().isEmpty())
          throw error.atNode(
              call.id(), call.version(), null, "@" + call.id() + ":" + call.version());
        throw error.inRule(call.id(), call.version());
      }
    }

    /** Registers a reached Output under its result field and returns its trace value. */
    private Object reachOutput(Node node, Object value) {
      String field = outputField(node);
      if (outputs.containsKey(field)) {
        Node previous = outputs.get(field).node();
        throw ArcException.invalid(
                "Duplicate output field '" + field + "'; set distinct Output names")
            .atNode(ruleId, version, previous.id(), previous.label());
      }
      outputs.put(field, new ReachedOutput(node, value));
      return namedOutput(node, value);
    }

    private Object result() {
      if (outputs.isEmpty()) throw ArcException.invalid("Execution did not reach an Output node");
      if (outputs.size() == 1) {
        ReachedOutput output = outputs.values().iterator().next();
        try {
          return Expressions.bounded(namedOutput(output.node(), output.value()));
        } catch (ArcException error) {
          throw error.atNode(ruleId, version, output.node().id(), output.node().label());
        }
      }
      var result = new LinkedHashMap<String, Object>();
      outputs.forEach((field, output) -> result.put(field, output.value()));
      return result;
    }
  }

  private static String outputField(Node node) {
    if (node.outputName() != null && !node.outputName().isEmpty()) return node.outputName();
    String expression = node.expression().trim();
    return Identifiers.isValid(expression) ? expression : node.id();
  }

  private static Object namedOutput(Node node, Object value) {
    if (node.outputName() == null || node.outputName().isEmpty()) return value;
    var named = new LinkedHashMap<String, Object>();
    named.put(node.outputName(), value);
    return named;
  }

  private static Object switchValue(Object value) {
    if (!(value instanceof Boolean || value instanceof Number || value instanceof String))
      throw ArcException.invalid("Expected a boolean, number or string");
    return value;
  }

  /** Names the failing field or case; exhausted budgets and the deadline keep their message. */
  private static ArcException inContext(ArcException error, String context) {
    return error.recoverable() ? error.withContext(context) : error;
  }

  private void checkStepBudget() {
    deadline.check();
    if (executedSteps >= Limits.MAX_EXECUTION_STEPS)
      throw ArcException.limit(
          "Execution exceeds " + Limits.format(Limits.MAX_EXECUTION_STEPS) + " steps");
  }
}
