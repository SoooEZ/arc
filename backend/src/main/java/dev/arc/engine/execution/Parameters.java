package dev.arc.engine.execution;

import dev.arc.engine.InputTypes;
import dev.arc.engine.SourceReader;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.*;
import java.util.*;

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

  public Map<String, Object> resolve(List<Input> parameters, Map<String, Object> supplied) {
    if (supplied == null) throw ArcException.invalid("inputs must be an object");
    var byName = new LinkedHashMap<String, Input>();
    parameters.forEach(p -> byName.put(p.name(), p));
    for (String name : supplied.keySet())
      if (!byName.containsKey(name)) throw ArcException.invalid("Unknown input: " + name);
    var values = new LinkedHashMap<String, Object>();
    for (Input p : parameters) resolveOne(p, byName, supplied, values, new HashSet<>());
    return values;
  }

  private void resolveOne(
      Input p,
      Map<String, Input> byName,
      Map<String, Object> supplied,
      Map<String, Object> values,
      Set<String> active) {
    if (values.containsKey(p.name())) return;
    if (!active.add(p.name()))
      throw ArcException.invalid("Circular source parameter dependency: " + p.name());
    Object value = p.defaultValue();
    if (supplied.containsKey(p.name())) value = supplied.get(p.name());
    else if (p.source() != null) {
      var b = p.source();
      long start = System.nanoTime();
      String status = "RESOLVED";
      var args = new LinkedHashMap<String, Object>();
      for (var e : b.bindings().entrySet()) {
        var expr = Expressions.compile(e.getValue());
        for (String name : expr.variables()) {
          Input dependency = byName.get(name);
          if (dependency == null) throw ArcException.invalid("Unknown source dependency: " + name);
          resolveOne(dependency, byName, supplied, values, active);
        }
        args.put(e.getKey(), expr.evaluate(values));
      }
      if (++fetches > 50) throw ArcException.invalid("Execution exceeds 50 source reads");
      try {
        value = sources.read(b, args);
        if (value == null && p.required())
          throw ArcException.invalid("Source returned null for required input");
        if (value != null) value = InputTypes.check(p.name(), p.type(), value);
      } catch (ArcException e) {
        if ("DEFAULT".equals(b.onError()) && p.defaultValue() != null) {
          value = p.defaultValue();
          status = "DEFAULT";
        } else throw ArcException.invalid(p.name() + ": " + e.getMessage());
      }
      reads.add(
          new Read(p.name(), b.id(), b.version(), status, (System.nanoTime() - start) / 1000));
    }
    if (value == null && p.required())
      throw ArcException.invalid("Missing required input: " + p.name());
    values.put(p.name(), value == null ? null : InputTypes.check(p.name(), p.type(), value));
    active.remove(p.name());
  }
}
