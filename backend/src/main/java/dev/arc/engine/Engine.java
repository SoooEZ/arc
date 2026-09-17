package dev.arc.engine;

import dev.arc.api.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.source.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class Engine {
  public record Step(
      String ruleId,
      Integer version,
      String nodeId,
      String label,
      String type,
      Object value,
      String branch,
      int depth) {}

  public record Result(
      Object result, List<Step> trace, long durationMicros, List<Parameters.Read> sources) {}

  private record Value(Object value, String origin) {}

  private final Validator validator;

  public Engine(Validator validator) {
    this.validator = validator;
  }

  public Result execute(
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver) {
    return execute(ruleId, version, definition, inputs, resolver, new Parameters(null));
  }

  public Result execute(
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver,
      Parameters parameters) {
    long start = System.nanoTime();
    List<Step> trace = new ArrayList<>();
    Object value =
        run(ruleId, version, definition, inputs, resolver, trace, new HashSet<>(), 0, parameters);
    return new Result(value, trace, (System.nanoTime() - start) / 1000, parameters.reads());
  }

  private Object run(
      String ruleId,
      Integer version,
      Definition d,
      Map<String, Object> inputs,
      RuleResolver resolver,
      List<Step> trace,
      Set<String> stack,
      int depth,
      Parameters parameters) {
    if (depth > 16) throw ArcException.invalid("Rule nesting exceeds 16 levels");
    String key = ruleId + "@" + version;
    if (!stack.add(key)) throw ArcException.invalid("Circular rule reference: " + key);
    try {
      validator.validate(d, resolver);
      var plan = new GraphPlan(d);
      Node input =
          plan.order.stream().filter(n -> n.type().equals("INPUT")).findFirst().orElseThrow();
      Map<String, Object> provided;
      try {
        provided = parameters.resolve(d.inputs(), inputs);
      } catch (ArcException e) {
        throw e.atNode(ruleId, version, input.id(), input.label());
      }
      Map<String, Map<String, Value>> scopes = new HashMap<>();
      Map<String, String> branches = new HashMap<>();
      Map<String, Object> outputs = new LinkedHashMap<>();
      // All parents have been resolved before a node runs, including skipped
      // branches. Fan-out gets independent scopes and a shared join runs once.
      for (Node node : plan.order) {
        Map<String, Value> values = new LinkedHashMap<>();
        boolean active = node.type().equals("INPUT");
        try {
          if (active)
            provided.forEach((name, value) -> values.put(name, new Value(value, input.id())));
          Map<String, Map<String, Value>> candidates = new LinkedHashMap<>();
          for (Edge edge : plan.incoming.getOrDefault(node.id(), List.of())) {
            if (!edge.sourceHandle().equals(branches.get(edge.source()))) continue;
            active = true;
            scopes
                .get(edge.source())
                .forEach(
                    (name, value) ->
                        candidates
                            .computeIfAbsent(name, k -> new LinkedHashMap<>())
                            .put(value.origin(), value));
          }
          if (!active) continue;
          for (var candidate : candidates.entrySet()) {
            var origins = candidate.getValue();
            var latest =
                origins.values().stream()
                    .filter(
                        v ->
                            origins.keySet().stream()
                                .noneMatch(other -> plan.ancestors.get(other).contains(v.origin())))
                    .toList();
            if (latest.size() != 1)
              throw ArcException.invalid(
                  "Conflicting upstream values for '"
                      + candidate.getKey()
                      + "'; use distinct result variable names before merging");
            values.put(candidate.getKey(), latest.getFirst());
          }
          if (trace.size() >= 1000) throw ArcException.invalid("Execution exceeds 1,000 steps");
          Map<String, Object> scope = new LinkedHashMap<>();
          values.forEach((name, value) -> scope.put(name, value.value()));
          Object value = null;
          String branch = "next";
          switch (node.type()) {
            case "INPUT" -> value = new LinkedHashMap<>(scope);
            case "FORMULA" -> value = Expressions.evaluate(node.expression(), scope);
            case "CONDITION" -> {
              value = Expressions.bool(Expressions.evaluate(node.expression(), scope));
              branch = value.toString();
            }
            case "REFERENCE" -> {
              var bound = new LinkedHashMap<String, Object>();
              if (node.bindings() != null)
                node.bindings()
                    .forEach((k, expr) -> bound.put(k, Expressions.evaluate(expr, scope)));
              value =
                  run(
                      node.ruleId(),
                      node.version(),
                      resolver.resolve(node.ruleId(), node.version()),
                      bound,
                      resolver,
                      trace,
                      stack,
                      depth + 1,
                      parameters);
            }
            case "OUTPUT" -> {
              value = Expressions.evaluate(node.expression(), scope);
              outputs.put(node.id(), value);
              branch = null;
            }
            default -> throw ArcException.invalid("Unknown node type");
          }
          if (node.type().equals("FORMULA") || node.type().equals("REFERENCE"))
            values.put(node.output(), new Value(value, node.id()));
          scopes.put(node.id(), values);
          branches.put(node.id(), branch);
          if (trace.size() >= 1000) throw ArcException.invalid("Execution exceeds 1,000 steps");
          trace.add(
              new Step(
                  ruleId, version, node.id(), node.label(), node.type(), value, branch, depth));
        } catch (ArcException e) {
          throw e.atNode(ruleId, version, node.id(), node.label());
        }
      }
      if (outputs.isEmpty()) throw ArcException.invalid("Execution did not reach an Output node");
      return outputs.size() == 1 ? outputs.values().iterator().next() : outputs;
    } catch (ArcException e) {
      throw e.inRule(ruleId, version);
    } finally {
      stack.remove(key);
    }
  }
}
