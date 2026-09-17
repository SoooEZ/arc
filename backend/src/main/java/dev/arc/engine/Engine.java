package dev.arc.engine;

import dev.arc.api.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.source.*;
import java.util.*;
import java.util.stream.Collectors;
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
    validator.validate(d, resolver);
    Map<String, Object> scope = parameters.resolve(d.inputs(), inputs);
    Map<String, Node> nodes = d.nodes().stream().collect(Collectors.toMap(Node::id, n -> n));
    Map<String, String> edges =
        d.edges().stream()
            .collect(Collectors.toMap(e -> e.source() + ":" + e.sourceHandle(), Edge::target));
    Node node = d.nodes().stream().filter(n -> n.type().equals("INPUT")).findFirst().orElseThrow();
    while (node != null) {
      if (trace.size() >= 1000) throw ArcException.invalid("Execution exceeds 1,000 steps");
      Object value = null;
      String branch = "next";
      try {
        switch (node.type()) {
          case "INPUT" -> value = new LinkedHashMap<>(scope);
          case "FORMULA" -> {
            value = Expressions.evaluate(node.expression(), scope);
            scope.put(node.output(), value);
          }
          case "CONDITION" -> {
            value = Expressions.bool(Expressions.evaluate(node.expression(), scope));
            branch = value.toString();
          }
          case "REFERENCE" -> {
            var bound = new LinkedHashMap<String, Object>();
            if (node.bindings() != null)
              node.bindings().forEach((k, expr) -> bound.put(k, Expressions.evaluate(expr, scope)));
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
            scope.put(node.output(), value);
          }
          case "OUTPUT" -> {
            value = Expressions.evaluate(node.expression(), scope);
            branch = null;
          }
          default -> throw ArcException.invalid("Unknown node type");
        }
      } catch (ArcException e) {
        throw ArcException.invalid(node.label() + ": " + e.getMessage());
      }
      if (trace.size() >= 1000) throw ArcException.invalid("Execution exceeds 1,000 steps");
      trace.add(
          new Step(ruleId, version, node.id(), node.label(), node.type(), value, branch, depth));
      if (node.type().equals("OUTPUT")) {
        stack.remove(key);
        return value;
      }
      node = nodes.get(edges.get(node.id() + ":" + branch));
    }
    throw ArcException.invalid("Execution did not reach an Output node");
  }
}
