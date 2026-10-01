package dev.arc.engine.expression;

import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.List;
import org.apache.poi.ss.formula.eval.ValueEval;

/**
 * The POI values of the ranges one evaluation converted most recently, so a lookup inside {@code
 * $MAP} converts its unchanged table once instead of per item. It belongs to a single top-level
 * evaluation and its nested contexts: never process-wide, because it keys the lists by identity. It
 * keeps a few ranges, not every list it converts: lists an item builds afresh never repeat, and
 * keeping them all held 682 MB for $COUNTIF($MMULT(col, row), x) over 1,000 items.
 */
final class RangeValues {
  /** Ranges kept, the most recently used first: enough for the tables one expression reads. */
  static final int CAPACITY = 16;

  private record Converted(List<?> list, ValueEval value) {}

  private final ArrayDeque<Converted> recent = new ArrayDeque<>();

  /** The POI value of an argument; a list converted recently is not converted again. */
  ValueEval value(Object argument) {
    if (!(argument instanceof List<?> list)) return ExcelFunctionAdapter.value(argument);
    for (Iterator<Converted> entries = recent.iterator(); entries.hasNext(); ) {
      Converted entry = entries.next();
      if (entry.list() == list) {
        entries.remove();
        recent.addFirst(entry);
        return entry.value();
      }
    }
    ValueEval converted = ExcelFunctionAdapter.value(list);
    recent.addFirst(new Converted(list, converted));
    if (recent.size() > CAPACITY) recent.removeLast();
    return converted;
  }

  /** The ranges kept now, for tests. */
  int retained() {
    return recent.size();
  }
}
