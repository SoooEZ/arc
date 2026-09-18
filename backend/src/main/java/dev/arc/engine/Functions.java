package dev.arc.engine;

import dev.arc.error.ArcException;
import java.math.*;
import java.util.*;

/** Stable expression-facing facade: decimal built-ins, catalog, and Excel adapter. */
public final class Functions {
  public record Entry(
      String name,
      String category,
      String signature,
      String description,
      String snippet,
      boolean supported,
      String origin) {}

  public static List<Entry> catalog() {
    return FunctionCatalog.catalog();
  }

  public static void arity(String name, int count) {
    FunctionCatalog.arity(name, count);
  }

  public static Object call(String name, List<Object> args) {
    if (List.of("SUM", "MIN", "MAX", "AVG", "AVERAGE", "COUNT", "MUL").contains(name)) {
      List<Object> flat = flatten(args);
      List<BigDecimal> ns = flat.stream().map(Expressions::number).toList();
      if (name.equals("COUNT")) return BigDecimal.valueOf(ns.size());
      if (ns.isEmpty() && !name.equals("SUM") && !name.equals("MUL"))
        throw ArcException.invalid(name + " requires values");
      return switch (name) {
        case "MIN" -> ns.stream().min(BigDecimal::compareTo).orElseThrow();
        case "MAX" -> ns.stream().max(BigDecimal::compareTo).orElseThrow();
        case "MUL" -> ns.stream().reduce(BigDecimal.ONE, (a, b) -> a.multiply(b, Expressions.MATH));
        default -> {
          var sum = ns.stream().reduce(BigDecimal.ZERO, (a, b) -> a.add(b, Expressions.MATH));
          yield name.equals("AVG") || name.equals("AVERAGE")
              ? sum.divide(BigDecimal.valueOf(ns.size()), Expressions.MATH)
              : sum;
        }
      };
    }
    Object first = args.isEmpty() ? null : args.getFirst();
    switch (name) {
      case "OBJECT":
        return DataFunctions.object(args);
      case "MERGE":
        return DataFunctions.merge(args);
      case "TO_NUMBER":
        return DataFunctions.number(first);
      case "TO_STRING":
        return DataFunctions.text(first);
      case "TO_BOOLEAN":
        return DataFunctions.bool(first);
      case "ABS":
        return Expressions.number(first).abs();
      case "FLOOR":
        return Expressions.number(first).setScale(0, RoundingMode.FLOOR);
      case "CEIL":
        return Expressions.number(first).setScale(0, RoundingMode.CEILING);
      case "ROUND":
      case "ROUNDDOWN":
      case "ROUNDUP":
        {
          int scale = 0;
          try {
            if (args.size() > 1) scale = Expressions.number(args.get(1)).intValueExact();
          } catch (ArithmeticException e) {
            throw ArcException.invalid("Round precision must be an integer");
          }
          if (Math.abs(scale) > 12) throw ArcException.invalid("Round precision must be -12 to 12");
          return Expressions.number(first)
              .setScale(
                  scale,
                  name.equals("ROUND")
                      ? RoundingMode.HALF_UP
                      : name.equals("ROUNDUP") ? RoundingMode.UP : RoundingMode.DOWN);
        }
      case "NOT":
        return !Expressions.bool(first);
      case "AND":
        return args.stream().allMatch(Expressions::bool);
      case "OR":
        return args.stream().anyMatch(Expressions::bool);
      case "XOR":
        return args.stream().filter(Expressions::bool).count() % 2 == 1;
      case "CONTAINS":
        return first instanceof List<?> xs
            ? xs.stream().anyMatch(x -> Expressions.equal(x, args.get(1)))
            : String.valueOf(first).contains(String.valueOf(args.get(1)));
      case "CONCAT":
        return String.join(
            "", flatten(args).stream().map(v -> v == null ? "" : v.toString()).toList());
      case "GET":
        return get(first, String.valueOf(args.get(1)), args.size() == 3 ? args.get(2) : null);
      case "PLUCK":
        return array(first).stream()
            .map(v -> get(v, String.valueOf(args.get(1)), args.size() == 3 ? args.get(2) : null))
            .toList();
      default:
        return ExcelFunctionAdapter.evaluate(name, args);
    }
  }

  public static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw ArcException.invalid("Expected an array");
    return list;
  }

  public static Object get(Object value, String path, Object fallback) {
    for (String part : path.split("\\.")) {
      if (value instanceof Map<?, ?> m && m.containsKey(part)) value = m.get(part);
      else if (value instanceof List<?> a
          && part.matches("\\d{1,6}")
          && Integer.parseInt(part) < a.size()) value = a.get(Integer.parseInt(part));
      else return fallback;
    }
    return value;
  }

  private static List<Object> flatten(List<?> args) {
    var out = new ArrayList<Object>();
    for (Object x : args) {
      if (x instanceof List<?> a) out.addAll(flatten(a));
      else out.add(x);
      if (out.size() > 10000) throw ArcException.invalid("Too many array values");
    }
    return out;
  }

  private Functions() {}
}
