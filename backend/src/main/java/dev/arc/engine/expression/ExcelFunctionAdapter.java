package dev.arc.engine.expression;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import org.apache.poi.ss.formula.CacheAreaEval;
import org.apache.poi.ss.formula.eval.*;
import org.apache.poi.ss.formula.function.FunctionMetadataRegistry;

/** Boundary between bounded ARC values and Apache POI's workbook-style value model. */
final class ExcelFunctionAdapter {
  private static ValueEval value(Object x) {
    if (x == null) return BlankEval.instance;
    if (x instanceof Number n) return new NumberEval(n.doubleValue());
    if (x instanceof Boolean b) return BoolEval.valueOf(b);
    if (x instanceof String s) return new StringEval(s);
    if (x instanceof List<?> a) {
      if (a.isEmpty()) return new CacheAreaEval(0, 0, 0, 0, new ValueEval[] {BlankEval.instance});
      int cols = a.getFirst() instanceof List<?> row ? row.size() : 1;
      if (cols == 0) throw ArcException.invalid("Excel ranges cannot contain empty rows");
      var vals = new ArrayList<ValueEval>();
      for (Object r : a) {
        List<?> row = r instanceof List<?> l ? l : Collections.singletonList(r);
        if (row.size() != cols) throw ArcException.invalid("Excel ranges must be rectangular");
        for (Object v : row) {
          if (v instanceof List<?> || v instanceof Map<?, ?>)
            throw ArcException.invalid("Excel range cells must be scalars");
          vals.add(value(v));
        }
      }
      return new CacheAreaEval(0, 0, a.size() - 1, cols - 1, vals.toArray(ValueEval[]::new));
    }
    throw ArcException.invalid("Excel functions require scalars or rectangular arrays");
  }

  private static Object converted(ValueEval result, String name) {
    if (result instanceof ErrorEval e) throw ArcException.invalid(name + ": " + e.getErrorString());
    if (result instanceof BoolEval b) return b.getBooleanValue();
    if (result instanceof NumberEval n) {
      if (!Double.isFinite(n.getNumberValue()))
        throw ArcException.invalid(name + ": non-finite result");
      return BigDecimal.valueOf(n.getNumberValue()).stripTrailingZeros();
    }
    if (result instanceof StringEval s) return s.getStringValue();
    if (result instanceof BlankEval) return null;
    if (result instanceof RefEval r)
      return converted(r.getInnerValueEval(r.getFirstSheetIndex()), name);
    if (result instanceof AreaEval area) {
      if (area.getHeight() > 1000
          || area.getWidth() > 1000
          || (long) area.getHeight() * area.getWidth() > 10000)
        throw ArcException.invalid("Excel result exceeds array limits");
      if (area.getHeight() == 1 && area.getWidth() == 1)
        return converted(area.getRelativeValue(0, 0), name);
      var rows = new ArrayList<Object>();
      for (int y = 0; y < area.getHeight(); y++) {
        var row = new ArrayList<Object>();
        for (int x = 0; x < area.getWidth(); x++)
          row.add(converted(area.getRelativeValue(y, x), name));
        rows.add(row);
      }
      return Expressions.bounded(rows);
    }
    throw ArcException.invalid(name + ": result requires workbook context");
  }

  static Object evaluate(String name, List<Object> args) {
    try {
      if (name.equals("COMBIN")
          && Expressions.number(args.getFirst()).abs().compareTo(BigDecimal.valueOf(10000)) > 0)
        throw ArcException.invalid("COMBIN supports n up to 10,000");
      if (Set.of("FIXED", "DOLLAR", "TRUNC").contains(name)
          && args.size() > 1
          && Expressions.number(args.get(1)).abs().compareTo(BigDecimal.valueOf(100)) > 0)
        throw ArcException.invalid(name + ": decimal places must be -100 to 100");
      if (name.equals("REPT")
          && (Expressions.number(args.get(1)).signum() < 0
              || Expressions.number(args.get(1)).compareTo(BigDecimal.valueOf(2000)) > 0
              || String.valueOf(args.getFirst()).length()
                      * Expressions.number(args.get(1)).doubleValue()
                  > 2000)) throw ArcException.invalid("REPT result exceeds string limit");
      var m = FunctionMetadataRegistry.getFunctionByName(name);
      ValueEval result =
          FunctionEval.getBasicFunction(m.getIndex())
              .evaluate(
                  args.stream().map(ExcelFunctionAdapter::value).toArray(ValueEval[]::new), 0, 0);
      return converted(result, name);
    } catch (ArcException e) {
      throw e;
    } catch (RuntimeException e) {
      throw ArcException.invalid(name + ": invalid arguments or unsupported workbook context");
    }
  }

  private ExcelFunctionAdapter() {}
}
