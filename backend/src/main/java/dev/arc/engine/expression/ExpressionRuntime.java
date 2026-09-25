package dev.arc.engine.expression;

import static dev.arc.engine.expression.Expressions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.expression.Expressions.Expr;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;

/** Decimal operators, short-circuit calls and collection execution; no parsing or IO. */
final class ExpressionRuntime {
  private ExpressionRuntime() {}

  /** Local bindings share their parent's budget, while separate evaluations never share state. */
  static final class Context {
    private final Map<String, Object> variables;
    private final Budget budget;
    private final ExecutionDeadline deadline;

    Context(Map<String, Object> variables, ExecutionDeadline deadline) {
      this(variables, new Budget(), deadline);
    }

    private Context(Map<String, Object> variables, Budget budget, ExecutionDeadline deadline) {
      this.deadline = deadline;
      this.variables = variables;
      this.budget = budget;
    }

    Object variable(String name) {
      if (!variables.containsKey(name)) throw ArcException.invalid("Unknown variable: " + name);
      return variables.get(name);
    }

    Context bind(String itemName, Object item, String accumulatorName, Object total) {
      var local = new HashMap<>(variables);
      local.put(itemName, item);
      if (accumulatorName != null) local.put(accumulatorName, total);
      return new Context(local, budget, deadline);
    }

    void tick() {
      deadline.check();
      if (++budget.operations > 10_000)
        throw ArcException.invalid("Expression exceeds 10,000 operations");
    }
  }

  private static final class Budget {
    private int operations;
  }

  static Object binary(String op, Object a, Object b) {
    if (Set.of("==", "!=", "=", "<>").contains(op)) {
      boolean same =
          a instanceof Number && b instanceof Number
              ? number(a).compareTo(number(b)) == 0
              : Objects.equals(a, b);
      return (op.equals("==") || op.equals("=")) == same;
    }
    if (Set.of("<", "<=", ">", ">=").contains(op)) {
      int cmp;
      if (a instanceof String x && b instanceof String y) cmp = x.compareTo(y);
      else cmp = number(a).compareTo(number(b));
      return switch (op) {
        case "<" -> cmp < 0;
        case "<=" -> cmp <= 0;
        case ">" -> cmp > 0;
        default -> cmp >= 0;
      };
    }
    BigDecimal x = number(a), y = number(b);
    if ((op.equals("/") || op.equals("%")) && y.signum() == 0)
      throw ArcException.invalid("Division by zero");
    try {
      return bounded(
          switch (op) {
            case "+" -> x.add(y, MATH);
            case "-" -> x.subtract(y, MATH);
            case "*" -> x.multiply(y, MATH);
            case "/" -> x.divide(y, MATH);
            case "%" -> x.remainder(y, MATH);
            case "^" -> {
              int exponent;
              try {
                exponent = y.intValueExact();
              } catch (ArithmeticException e) {
                throw ArcException.invalid("Exponent must be an integer");
              }
              if (Math.abs((long) exponent) > 100)
                throw ArcException.invalid("Exponent must be -100 to 100");
              try {
                yield exponent < 0
                    ? BigDecimal.ONE.divide(x.pow(-exponent, MATH), MATH)
                    : x.pow(exponent, MATH);
              } catch (ArithmeticException e) {
                throw ArcException.invalid("Invalid power");
              }
            }
            default -> throw ArcException.invalid("Unknown operator: " + op);
          });
    } catch (ArithmeticException error) {
      throw ArcException.invalid("Decimal operation exceeds supported precision");
    }
  }

  static Object function(String name, List<Expr> args, Context context) {
    context.tick();
    if (name.equals("COALESCE")) {
      for (Expr argument : args) {
        Object value = argument.eval(context);
        if (value != null) return value;
      }
      return null;
    }
    if (name.equals("IF")) return args.get(bool(args.get(0).eval(context)) ? 1 : 2).eval(context);
    if (Set.of("ISERROR", "ISERR", "ISNA").contains(name)) {
      try {
        args.getFirst().eval(context);
        return false;
      } catch (ArcException e) {
        deadlineCheck(context, e);
        boolean na = e.getMessage().contains("#N/A");
        return name.equals("ISERROR") || name.equals("ISNA") && na || name.equals("ISERR") && !na;
      }
    }
    if (name.equals("IFERROR")) {
      try {
        return args.get(0).eval(context);
      } catch (ArcException e) {
        deadlineCheck(context, e);
        return args.get(1).eval(context);
      }
    }
    if (name.equals("AND")) return args.stream().allMatch(a -> bool(a.eval(context)));
    if (name.equals("OR")) return args.stream().anyMatch(a -> bool(a.eval(context)));
    if (name.equals("SWITCH")) {
      Object v = args.getFirst().eval(context);
      for (int i = 1; i + 1 < args.size(); i += 2)
        if (equal(v, args.get(i).eval(context))) return args.get(i + 1).eval(context);
      if (args.size() % 2 == 0) return args.getLast().eval(context);
      throw ArcException.invalid("SWITCH has no matching case or default");
    }
    return bounded(Functions.call(name, args.stream().map(a -> a.eval(context)).toList()));
  }

  private static void deadlineCheck(Context context, ArcException error) {
    context.deadline.check();
    if (error.status() == 504) throw error;
  }

  static Object collection(
      String name,
      Expr collection,
      String local,
      String accumulator,
      Expr initial,
      Expr body,
      Context context) {
    var items = Functions.array(collection.eval(context));
    var result = new ArrayList<Object>();
    Object total = initial == null ? null : initial.eval(context);
    for (Object item : items) {
      context.tick();
      Context child = context.bind(local, item, accumulator, total);
      Object value = body.eval(child);
      switch (name) {
        case "MAP" -> result.add(value);
        case "FILTER" -> {
          if (bool(value)) result.add(item);
        }
        case "ALL" -> {
          if (!bool(value)) return false;
        }
        case "ANY" -> {
          if (bool(value)) return true;
        }
        case "REDUCE" -> total = value;
      }
    }
    return bounded(
        switch (name) {
          case "REDUCE" -> total;
          case "ALL" -> true;
          case "ANY" -> false;
          default -> result;
        });
  }
}
