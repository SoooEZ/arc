package dev.arc.engine.expression;

import static dev.arc.engine.expression.Expressions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.engine.ValueBounds;
import dev.arc.engine.expression.Expressions.Expr;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;

/** Decimal operators, short-circuit calls and collection execution; no parsing or IO. */
final class ExpressionRuntime {
  /** The largest exponent of {@code ^}, in either direction. */
  static final int MAX_EXPONENT = 100;

  private ExpressionRuntime() {}

  /**
   * One evaluation's variables, operation budget and deadline. A collection item binds its local
   * identifiers in front of the enclosing context instead of copying the whole scope, so binding
   * costs the same for 2 or 150 upstream variables. Inner locals shadow outer names.
   */
  static final class Context {
    private final Map<String, Object> scope;
    private final Local locals;
    private final Budget budget;

    /** Shared with nested contexts like the budget: one conversion per range per evaluation. */
    private final RangeValues ranges;

    private final ExecutionDeadline deadline;
    private final FormulaCaller formulas;

    Context(Map<String, Object> scope, ExecutionDeadline deadline, FormulaCaller formulas) {
      this(scope, null, new Budget(), new RangeValues(), deadline, formulas);
    }

    private Context(
        Map<String, Object> scope,
        Local locals,
        Budget budget,
        RangeValues ranges,
        ExecutionDeadline deadline,
        FormulaCaller formulas) {
      this.scope = scope;
      this.locals = locals;
      this.budget = budget;
      this.ranges = ranges;
      this.deadline = deadline;
      this.formulas = formulas;
    }

    Object variable(String name) {
      for (Local local = locals; local != null; local = local.enclosing()) {
        if (local.name().equals(name)) return local.value();
      }
      if (!scope.containsKey(name)) throw ArcException.invalid("Unknown variable: " + name);
      return scope.get(name);
    }

    Context bind(String itemName, Object item, String accumulatorName, Object total) {
      Local bound = new Local(itemName, item, locals);
      if (accumulatorName != null) bound = new Local(accumulatorName, total, bound);
      return new Context(scope, bound, budget, ranges, deadline, formulas);
    }

    void tick() {
      deadline.check();
      if (++budget.operations > Limits.MAX_EXPRESSION_OPERATIONS)
        throw ArcException.limit(
            "Expression exceeds "
                + Limits.format(Limits.MAX_EXPRESSION_OPERATIONS)
                + " operations");
    }
  }

  /** A collection-local binding; values may be null, which is distinct from an unknown name. */
  private record Local(String name, Object value, Local enclosing) {}

  private static final class Budget {
    private int operations;
  }

  /** Functions whose arguments are evaluated on demand rather than before the call. */
  @FunctionalInterface
  private interface LazyFunction {
    Object evaluate(List<Expr> args, Context context);
  }

  private static final Map<String, LazyFunction> LAZY_FUNCTIONS =
      Map.of(
          "COALESCE", ExpressionRuntime::coalesce,
          "IF", ExpressionRuntime::ifThenElse,
          "IFERROR", ExpressionRuntime::ifError,
          "ISERROR", (args, context) -> isError("ISERROR", args, context),
          "ISERR", (args, context) -> isError("ISERR", args, context),
          "ISNA", (args, context) -> isError("ISNA", args, context),
          "AND", ExpressionRuntime::and,
          "OR", ExpressionRuntime::or,
          "SWITCH", ExpressionRuntime::switchCase,
          "CHOOSE", ExpressionRuntime::choose);

  /** Functions whose arguments the runtime evaluates on demand instead of before the call. */
  static Set<String> lazyFunctionNames() {
    return LAZY_FUNCTIONS.keySet();
  }

  /**
   * The graph session bounds each returned Output value. A multi-Output aggregate is not bounded
   * again as a whole, so a Formula call receives exactly the value a Reference node would store.
   */
  static Object formula(FormulaCall formula, List<Expr> arguments, Context context) {
    context.tick();
    var values = arguments.stream().map(argument -> argument.eval(context)).toList();
    Object result = context.formulas.call(formula, values);
    context.deadline.check();
    return result;
  }

  /** The parser evaluates AND and OR itself, because they short-circuit. */
  static Object binary(BinaryOperator op, Object a, Object b) {
    return switch (op) {
      case EQUAL -> equal(a, b);
      case NOT_EQUAL -> !equal(a, b);
      case LESS, LESS_OR_EQUAL, GREATER, GREATER_OR_EQUAL -> compare(op, a, b);
      case ADD, SUBTRACT, MULTIPLY, DIVIDE, REMAINDER, POWER -> arithmetic(op, a, b);
      case AND, OR -> throw new IllegalArgumentException(op + " short-circuits in the parser");
    };
  }

  private static boolean compare(BinaryOperator op, Object a, Object b) {
    int cmp;
    if (a instanceof String x && b instanceof String y) cmp = x.compareTo(y);
    else cmp = number(a).compareTo(number(b));
    return switch (op) {
      case LESS -> cmp < 0;
      case LESS_OR_EQUAL -> cmp <= 0;
      case GREATER -> cmp > 0;
      default -> cmp >= 0;
    };
  }

  private static Object arithmetic(BinaryOperator op, Object a, Object b) {
    BigDecimal x = number(a), y = number(b);
    if ((op == BinaryOperator.DIVIDE || op == BinaryOperator.REMAINDER) && y.signum() == 0)
      throw ArcException.invalid("Division by zero");
    try {
      return bounded(
          ValueBounds.computed(
              switch (op) {
                case ADD -> x.add(y, MATH);
                case SUBTRACT -> x.subtract(y, MATH);
                case MULTIPLY -> x.multiply(y, MATH);
                case DIVIDE -> x.divide(y, MATH);
                case REMAINDER -> x.remainder(y, MATH);
                case POWER -> power(x, y);
                default -> throw new IllegalArgumentException(op + " is not arithmetic");
              }));
    } catch (ArithmeticException error) {
      throw ArcException.invalid("Decimal operation exceeds supported precision");
    }
  }

  private static BigDecimal power(BigDecimal x, BigDecimal y) {
    int exponent;
    try {
      exponent = y.intValueExact();
    } catch (ArithmeticException e) {
      throw ArcException.invalid("Exponent must be an integer");
    }
    if (Math.abs((long) exponent) > MAX_EXPONENT)
      throw ArcException.invalid("Exponent must be -" + MAX_EXPONENT + " to " + MAX_EXPONENT);
    try {
      return exponent < 0
          ? BigDecimal.ONE.divide(x.pow(-exponent, MATH), MATH)
          : x.pow(exponent, MATH);
    } catch (ArithmeticException e) {
      throw ArcException.invalid("Invalid power");
    }
  }

  static Object function(String name, List<Expr> args, Context context) {
    context.tick();
    LazyFunction lazy = LAZY_FUNCTIONS.get(name);
    if (lazy != null) return lazy.evaluate(args, context);
    Object result =
        Functions.call(name, args.stream().map(a -> a.eval(context)).toList(), context.ranges);
    // POI cannot be interrupted, so a slow Excel calculation is caught as soon as it returns.
    context.deadline.check();
    return bounded(result instanceof BigDecimal number ? ValueBounds.computed(number) : result);
  }

  private static Object coalesce(List<Expr> args, Context context) {
    for (Expr argument : args) {
      Object value = argument.eval(context);
      if (value != null) return value;
    }
    return null;
  }

  private static Object ifThenElse(List<Expr> args, Context context) {
    return args.get(bool(args.get(0).eval(context)) ? 1 : 2).eval(context);
  }

  private static Object ifError(List<Expr> args, Context context) {
    try {
      return args.get(0).eval(context);
    } catch (ArcException error) {
      rethrowUnrecoverable(context, error);
      return args.get(1).eval(context);
    }
  }

  private static boolean isError(String name, List<Expr> args, Context context) {
    try {
      args.getFirst().eval(context);
      return false;
    } catch (ArcException error) {
      rethrowUnrecoverable(context, error);
      boolean notAvailable = error.kind() == ArcException.Kind.NOT_AVAILABLE;
      return switch (name) {
        case "ISNA" -> notAvailable;
        case "ISERR" -> !notAvailable;
        default -> true;
      };
    }
  }

  private static boolean and(List<Expr> args, Context context) {
    for (Expr argument : args) {
      if (!bool(argument.eval(context))) return false;
    }
    return true;
  }

  private static boolean or(List<Expr> args, Context context) {
    for (Expr argument : args) {
      if (bool(argument.eval(context))) return true;
    }
    return false;
  }

  private static Object switchCase(List<Expr> args, Context context) {
    Object value = args.getFirst().eval(context);
    for (int i = 1; i + 1 < args.size(); i += 2) {
      if (equal(value, args.get(i).eval(context))) return args.get(i + 1).eval(context);
    }
    if (args.size() % 2 == 0) return args.getLast().eval(context);
    // Excel's #N/A, which $ISNA recognizes and $ISERR does not.
    throw ArcException.notAvailable("SWITCH has no matching case or default");
  }

  /** Like Excel, $CHOOSE evaluates only the selected value; the others may fail or be costly. */
  private static Object choose(List<Expr> args, Context context) {
    int index = ExcelFunctionAdapter.choiceIndex(args.getFirst().eval(context));
    if (index < 1 || index >= args.size()) throw ArcException.invalid("CHOOSE: #VALUE!");
    return args.get(index).eval(context);
  }

  /** Error functions test one value; exhausted budgets and the deadline always propagate. */
  private static void rethrowUnrecoverable(Context context, ArcException error) {
    context.deadline.check();
    if (!error.recoverable()) throw error;
  }

  /** The per-item step's answer while a collection function has not decided its value yet. */
  private static final Object UNDECIDED = new Object();

  /**
   * Runs a collection function's body once per item. Both switches are expressions, so a new
   * constant does not compile until it decides its per-item step and its final value.
   */
  static Object collection(
      CollectionFunction function,
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
      // ALL and ANY stop at the first deciding item; the others visit every item.
      Object decided =
          switch (function) {
            case MAP -> {
              result.add(value);
              yield UNDECIDED;
            }
            case FILTER -> {
              if (bool(value)) result.add(item);
              yield UNDECIDED;
            }
            case ALL -> bool(value) ? UNDECIDED : false;
            case ANY -> bool(value) ? true : UNDECIDED;
            case REDUCE -> {
              total = value;
              yield UNDECIDED;
            }
          };
      if (decided != UNDECIDED) return decided;
    }
    return bounded(
        switch (function) {
          case MAP, FILTER -> result;
          case ALL -> true;
          case ANY -> false;
          case REDUCE -> total;
        });
  }
}
