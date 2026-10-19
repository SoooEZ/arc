package dev.arc.engine.execution;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.table.DecisionTables;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.ExpressionPositions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import java.util.*;
import java.util.function.Function;
import java.util.function.Supplier;

/** One execution session; nested rules share its trace, recursion guard and source-read budget. */
final class GraphExecution {
  /**
   * What a node produced: its value, the handle it left through and, for a decision table, the rows
   * that produced the value, numbered from 1 for the trace.
   */
  private record Outcome(Object value, String branch, List<Integer> matchedRows) {
    Outcome(Object value, String branch) {
      this(value, branch, null);
    }
  }

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
    return invoke(ruleId, version, definition, depth, compiled -> inputs);
  }

  /**
   * Runs one rule invocation whose inputs may depend on the prepared plan (positional Formula
   * arguments are mapped onto the callee's declared inputs). Nested pins pass their read as the
   * supplier, so a cached plan costs no repository read and no decoding.
   */
  private Object invoke(
      String ruleId,
      Integer version,
      Supplier<Definition> definition,
      int depth,
      Function<CompiledGraph, Map<String, Object>> inputsFor) {
    if (depth > Limits.MAX_NESTING_DEPTH)
      throw ArcException.limit("Rule nesting exceeds " + Limits.MAX_NESTING_DEPTH + " levels");
    String key = ruleId + "@" + version;
    if (!activeRules.add(key)) throw ArcException.invalid("Circular rule reference: " + key);
    try {
      CompiledGraph compiled = prepare(ruleId, version, definition);
      return new RuleRun(ruleId, version, compiled, depth).execute(inputsFor.apply(compiled));
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
      this.plan = compiled.plan();
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
        // The Input node is the run's first step: a run past the budget reads none of its sources.
        checkStepBudget();
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
              outcome.matchedRows(),
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
        case DECISION_TABLE -> decide(node, scope);
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

    // A value error names the position it failed in, as static diagnostics name it; a limit or
    // the deadline keeps its message, which withContext decides.
    private Object selector(Node node, Map<String, Object> scope) {
      try {
        return switchValue(eval(node.selector(), scope));
      } catch (ArcException error) {
        throw error.withContext(ExpressionPositions.SELECTOR);
      }
    }

    private boolean matches(BranchCase option, Object selector, Map<String, Object> scope) {
      try {
        Object value = eval(option.expression(), scope);
        return selector == null
            ? Expressions.bool(value)
            : Expressions.equal(selector, switchValue(value));
      } catch (ArcException error) {
        throw error.withContext(ExpressionPositions.switchCase(option));
      }
    }

    private Object transform(Node node, Map<String, Object> scope) {
      if (node.fields() == null || node.fields().isEmpty()) return eval(node.expression(), scope);
      var transformed = new LinkedHashMap<String, Object>();
      for (Field field : node.fields()) {
        try {
          transformed.put(field.name(), eval(field.expression(), scope));
        } catch (ArcException error) {
          throw error.withContext(ExpressionPositions.transformField(field));
        }
      }
      return Expressions.bounded(transformed);
    }

    /**
     * Evaluates each condition once, in column order, lets the compiled table select its rows and
     * evaluates only their results. One result column gives its value, several an object keyed by
     * result name; COLLECT gives a list of those, one per matching row.
     */
    private Outcome decide(Node node, Map<String, Object> scope) {
      DecisionTable table = node.table();
      var values = new ArrayList<Object>(table.conditions().size());
      for (DecisionTable.Condition condition : table.conditions()) {
        try {
          values.add(eval(condition.expression(), scope));
        } catch (ArcException error) {
          throw error.withContext(ExpressionPositions.tableCondition(condition));
        }
      }
      DecisionTables.Compiled matcher = compiled.table(node.id());
      List<Integer> rows = matcher.select(values);
      var results = new ArrayList<Object>(rows.size());
      var numbers = new ArrayList<Integer>(rows.size());
      for (int row : rows) {
        results.add(rowResult(table, row, scope));
        numbers.add(row + 1);
      }
      Object value =
          matcher.policy() == DecisionTable.HitPolicy.COLLECT
              ? Expressions.bounded(results)
              : results.getFirst();
      return new Outcome(value, Handles.NEXT, List.copyOf(numbers));
    }

    private Object rowResult(DecisionTable table, int row, Map<String, Object> scope) {
      List<String> then = table.rows().get(row).then();
      if (then.size() == 1) return result(table, row, 0, scope);
      var fields = new LinkedHashMap<String, Object>();
      for (int column = 0; column < then.size(); column++)
        fields.put(table.results().get(column).name(), result(table, row, column, scope));
      return Expressions.bounded(fields);
    }

    private Object result(DecisionTable table, int row, int column, Map<String, Object> scope) {
      try {
        return eval(table.rows().get(row).then().get(column), scope);
      } catch (ArcException error) {
        String result = ExpressionPositions.tableResult(table.results().get(column), column);
        throw error.withContext(ExpressionPositions.tableCell(row, result));
      }
    }

    private Object reference(Node node, Map<String, Object> scope) {
      var inputs = new LinkedHashMap<String, Object>();
      if (node.bindings() != null) {
        for (var binding : node.bindings().entrySet()) {
          try {
            inputs.put(binding.getKey(), eval(binding.getValue(), scope));
          } catch (ArcException error) {
            throw error.withContext(ExpressionPositions.referenceBinding(binding.getKey()));
          }
        }
      }
      // The read is the supplier: a plan this session or the process already holds needs none.
      // A missing version fails the definition through prepare(), as before.
      return run(
          node.ruleId(),
          node.version(),
          () -> resolver.resolve(node.ruleId(), node.version()),
          inputs,
          depth + 1);
    }

    /**
     * The Formula kind is checked when the pin is read (resolveFormula). A cached plan skips the
     * read, which is sound: the caller's compile already resolved this call as a Formula, a rule's
     * kind never changes for its ID, and deleting a rule evicts its plans.
     */
    private Object callFormula(Expressions.FormulaCall call, List<Object> arguments) {
      try {
        deadline.check();
        return invoke(
            call.id(),
            call.version(),
            () -> resolver.resolveFormula(call.id(), call.version()),
            depth + 1,
            compiled -> positionalInputs(call, compiled.definition(), arguments));
      } catch (ArcException error) {
        // invoke already placed a located failure in the called rule; an unlocated one is the
        // call's.
        throw error.locations().isEmpty()
            ? error.atNode(call.id(), call.version(), null, call.written())
            : error;
      }
    }

    /** Positional arguments mapped onto the callee's declared inputs, in declaration order. */
    private static Map<String, Object> positionalInputs(
        Expressions.FormulaCall call, Definition child, List<Object> arguments) {
      if (arguments.size() > child.inputs().size())
        throw ArcException.invalid("Too many arguments for " + call.written());
      var inputs = new LinkedHashMap<String, Object>();
      for (int index = 0; index < arguments.size(); index++)
        inputs.put(child.inputs().get(index).name(), arguments.get(index));
      return inputs;
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
        // The evaluation bounded the value; only a name wraps it in another level and field.
        if (output.node().outputFieldName() == null) return output.value();
        try {
          return Expressions.bounded(namedOutput(output.node(), output.value()));
        } catch (ArcException error) {
          throw error.atNode(ruleId, version, output.node().id(), output.node().label());
        }
      }
      // Each value is bounded; the aggregate has a budget as a whole (Limits.MAX_RESULT_*), so a
      // rule with many Outputs cannot stream gigabytes or fill a parent's scopes through
      // References, and both callers of the rule meet the same limit (lesson B19). Located at the
      // Output that passes it, as the single Output's bound is.
      var result = new LinkedHashMap<String, Object>();
      long elements = 1;
      long characters = 0;
      for (var entry : outputs.entrySet()) {
        ReachedOutput output = entry.getValue();
        var size = Expressions.size(output.value());
        elements += 1 + size.elements();
        characters += entry.getKey().length() + size.characters();
        if (elements > Limits.MAX_RESULT_ELEMENTS)
          throw resultLimit(Limits.MAX_RESULT_ELEMENTS, "elements", output.node());
        if (characters > Limits.MAX_RESULT_CHARACTERS)
          throw resultLimit(Limits.MAX_RESULT_CHARACTERS, "characters of text", output.node());
        result.put(entry.getKey(), output.value());
      }
      return result;
    }

    private ArcException resultLimit(int limit, String unit, Node output) {
      return ArcException.limit(
              "Result exceeds " + Limits.format(limit) + " " + unit + " across its Outputs")
          .atNode(ruleId, version, output.id(), output.label());
    }
  }

  private static String outputField(Node node) {
    String name = node.outputFieldName();
    if (name != null) return name;
    String expression = node.expression().trim();
    return Identifiers.isValid(expression) ? expression : node.id();
  }

  private static Object namedOutput(Node node, Object value) {
    String name = node.outputFieldName();
    if (name == null) return value;
    var named = new LinkedHashMap<String, Object>();
    named.put(name, value);
    return named;
  }

  private static Object switchValue(Object value) {
    if (!(value instanceof Boolean || value instanceof Number || value instanceof String))
      throw ArcException.invalid("Expected a boolean, number or string");
    return value;
  }

  private void checkStepBudget() {
    deadline.check();
    if (executedSteps >= Limits.MAX_EXECUTION_STEPS)
      throw ArcException.limit(
          "Execution exceeds " + Limits.format(Limits.MAX_EXECUTION_STEPS) + " steps");
  }
}
