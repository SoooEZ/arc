package dev.arc.engine.execution;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.InputTypes;
import dev.arc.engine.Limits;
import dev.arc.engine.SourceReader;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.validation.ExpressionPositions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.function.Function;

/** One resolver per execution. Caller values win; source dependencies resolve recursively. */
public final class Parameters {
  public record Read(
      String input, String sourceId, int version, String status, long durationMicros) {}

  private final SourceReader sources;
  private final List<Read> reads = new ArrayList<>();
  private int fetches;

  public Parameters(SourceReader sources) {
    this.sources = sources == null ? SourceReader.unavailable() : sources;
  }

  public List<Read> reads() {
    return List.copyOf(reads);
  }

  /**
   * Resolves inputs in declaration order. A sourced input first resolves the inputs its arguments
   * read, also in declaration order, so source reads and the first failure are reproducible. Source
   * reads share the execution's deadline and read budget.
   */
  public Map<String, Object> resolve(
      List<Input> parameters,
      Map<String, Object> supplied,
      Function<String, Expressions.Compiled> expressions,
      ExecutionDeadline deadline,
      Expressions.FormulaCaller formulas) {
    deadline.check();
    if (supplied == null) throw ArcException.invalid("inputs must be an object");
    return new Resolution(parameters, supplied, expressions, deadline, formulas).resolveAll();
  }

  /** State of one resolve call; the source-read budget and read log belong to the execution. */
  private final class Resolution {
    private final List<Input> parameters;
    private final Map<String, Input> declared = new LinkedHashMap<>();
    private final Map<String, Object> supplied;
    private final Function<String, Expressions.Compiled> expressions;
    private final ExecutionDeadline deadline;
    private final Expressions.FormulaCaller formulas;
    private final Map<String, Object> resolved = new LinkedHashMap<>();
    private final Set<String> resolving = new HashSet<>();

    Resolution(
        List<Input> parameters,
        Map<String, Object> supplied,
        Function<String, Expressions.Compiled> expressions,
        ExecutionDeadline deadline,
        Expressions.FormulaCaller formulas) {
      this.parameters = parameters;
      this.supplied = supplied;
      this.expressions = expressions;
      this.deadline = deadline;
      this.formulas = formulas;
      for (Input parameter : parameters) declared.put(parameter.name(), parameter);
    }

    Map<String, Object> resolveAll() {
      for (String name : supplied.keySet())
        if (!declared.containsKey(name)) throw ArcException.invalid("Unknown input: " + name);
      for (Input parameter : parameters) resolve(parameter);
      return resolved;
    }

    private void resolve(Input parameter) {
      deadline.check();
      String name = parameter.name();
      if (resolved.containsKey(name)) return;
      if (!resolving.add(name))
        throw ArcException.invalid("Circular source parameter dependency: " + name);
      Object value = parameter.defaultValue();
      if (supplied.containsKey(name)) value = supplied.get(name);
      else if (parameter.source() != null) value = read(parameter);
      if (value == null && parameter.required())
        throw ArcException.invalid("Missing required input: " + name);
      resolved.put(name, value == null ? null : InputTypes.check(name, parameter.type(), value));
      resolving.remove(name);
    }

    /** Only recoverable value errors may use the DEFAULT fallback; limits and expiry propagate. */
    private Object read(Input parameter) {
      SourceBinding source = parameter.source();
      // The reported duration includes resolving the inputs that the arguments read.
      long start = System.nanoTime();
      var arguments = new LinkedHashMap<String, Expressions.Compiled>();
      for (var binding : source.bindings().entrySet())
        arguments.put(binding.getKey(), expressions.apply(binding.getValue()));
      for (Input dependency : dependencies(arguments.values())) resolve(dependency);
      var argumentValues = new LinkedHashMap<String, Object>();
      for (var argument : arguments.entrySet()) {
        try {
          argumentValues.put(
              argument.getKey(), argument.getValue().evaluate(resolved, deadline, formulas));
        } catch (ArcException error) {
          // Named like the static diagnostic; an expired deadline is reported as such first.
          deadline.check();
          throw error.withContext(
              ExpressionPositions.sourceMapping(parameter.name(), argument.getKey()));
        }
      }
      if (++fetches > Limits.MAX_SOURCE_READS)
        throw ArcException.limit("Execution exceeds " + Limits.MAX_SOURCE_READS + " source reads");
      Object value;
      String status = "RESOLVED";
      try {
        // A value that arrives after the deadline is never used, whichever reader returned it.
        value = deadline.within(() -> sources.read(source, argumentValues, deadline));
        if (value == null && parameter.required())
          throw ArcException.invalid("Source returned null for required input");
        if (value != null) value = InputTypes.check(parameter.name(), parameter.type(), value);
      } catch (ArcException error) {
        deadline.check();
        if (!error.recoverable()) throw error;
        if (!"DEFAULT".equals(source.onError()) || parameter.defaultValue() == null)
          throw ArcException.invalid(parameter.name() + ": " + error.getMessage());
        value = parameter.defaultValue();
        status = "DEFAULT";
      }
      long durationMicros = (System.nanoTime() - start) / 1000;
      reads.add(new Read(parameter.name(), source.id(), source.version(), status, durationMicros));
      return value;
    }

    /** Declared inputs read by the arguments, in declaration order rather than hash order. */
    private List<Input> dependencies(Collection<Expressions.Compiled> arguments) {
      Set<String> referenced = new TreeSet<>();
      for (Expressions.Compiled argument : arguments) referenced.addAll(argument.variables());
      var dependencies = new ArrayList<Input>();
      for (Input input : declared.values())
        if (referenced.remove(input.name())) dependencies.add(input);
      // Any remaining name is undeclared; the sorted set keeps the reported name stable.
      if (!referenced.isEmpty())
        throw ArcException.invalid("Unknown source dependency: " + referenced.iterator().next());
      return dependencies;
    }
  }
}
