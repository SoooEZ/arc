package dev.arc.engine.expression;

import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.formula.eval.ValueEval;

/**
 * The POI values of the ranges one evaluation converts, so a lookup inside {@code $MAP} converts
 * its unchanged table once instead of per item. It belongs to a single top-level evaluation and its
 * nested contexts: never process-wide, because it keys the lists by identity and holds their
 * converted values only as long as that evaluation runs.
 */
final class RangeValues {
  private final Map<List<?>, ValueEval> converted = new IdentityHashMap<>();

  /** The POI value of an argument; a list is converted once per evaluation. */
  ValueEval value(Object argument) {
    if (!(argument instanceof List<?> list)) return ExcelFunctionAdapter.value(argument);
    ValueEval cached = converted.get(list);
    if (cached == null) {
      cached = ExcelFunctionAdapter.value(list);
      converted.put(list, cached);
    }
    return cached;
  }
}
