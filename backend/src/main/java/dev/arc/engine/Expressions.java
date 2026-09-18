package dev.arc.engine;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.*;
import java.util.regex.Pattern;

/**
 * A bounded expression language with decimal arithmetic and a function registry. No reflection,
 * scripting, IO, or arbitrary calls.
 */
public final class Expressions {
  public static final MathContext MATH = MathContext.DECIMAL128;
  private static final Pattern TOKEN =
      Pattern.compile(
          "\\s*(?:(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.\\d+)|([A-Za-z_][A-Za-z_0-9.]*)|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')|(&&|\\|\\||==|!=|<>|<=|>=|[=^\\[\\]+*/%<>()!,\\-]))");

  private Expressions() {}

  public interface Expr {
    Object eval(Map<String, Object> variables);
  }

  public record Compiled(Expr expr, Set<String> variables) {
    public Object evaluate(Map<String, Object> scope) {
      WORK.set(0);
      try {
        return bounded(expr.eval(scope));
      } finally {
        WORK.remove();
      }
    }
  }

  public static Compiled compile(String source) {
    if (source == null || source.isBlank()) throw ArcException.invalid("Expression is required");
    if (source.length() > 2000) throw ArcException.invalid("Expression exceeds 2,000 characters");
    var parser = new Parser(source.trim());
    Expr expr = parser.parse(0);
    if (!parser.peek().equals("<end>"))
      throw ArcException.invalid("Unexpected token: " + parser.peek());
    return new Compiled(expr, Set.copyOf(parser.variables));
  }

  public static Object evaluate(String source, Map<String, Object> scope) {
    return compile(source).evaluate(scope);
  }

  public static BigDecimal number(Object value) {
    if (!(value instanceof Number))
      throw ArcException.invalid("Expected a number, got " + type(value));
    try {
      return (BigDecimal)
          bounded(value instanceof BigDecimal b ? b : new BigDecimal(value.toString()));
    } catch (NumberFormatException e) {
      throw ArcException.invalid("Invalid numeric value");
    }
  }

  public static boolean bool(Object value) {
    if (!(value instanceof Boolean b))
      throw ArcException.invalid("Expected a boolean, got " + type(value));
    return b;
  }

  private static final ThreadLocal<Integer> WORK = ThreadLocal.withInitial(() -> 0);

  private static void tick() {
    int n = WORK.get() + 1;
    if (n > 10000) throw ArcException.invalid("Expression exceeds 10,000 operations");
    WORK.set(n);
  }

  public static Object bounded(Object value) {
    bound(value, 0, new int[] {0});
    return value;
  }

  private static void bound(Object value, int depth, int[] count) {
    if (depth > 8 || ++count[0] > 10000)
      throw ArcException.invalid("Value exceeds collection depth or size limit");
    if (value instanceof BigDecimal n && (n.precision() > 100 || Math.abs((long) n.scale()) > 100))
      throw ArcException.invalid("Number exceeds supported precision or magnitude");
    if (value instanceof Number n && !Double.isFinite(n.doubleValue()))
      throw ArcException.invalid("Number must be finite");
    if (value instanceof String s && s.length() > 2000)
      throw ArcException.invalid("String exceeds 2,000 characters");
    if (value instanceof List<?> xs) {
      if (xs.size() > 1000) throw ArcException.invalid("Array exceeds 1,000 items");
      for (Object x : xs) bound(x, depth + 1, count);
    }
    if (value instanceof Map<?, ?> m) {
      if (m.size() > 1000) throw ArcException.invalid("Object exceeds 1,000 fields");
      for (var e : m.entrySet()) {
        bound(e.getKey(), depth + 1, count);
        bound(e.getValue(), depth + 1, count);
      }
    }
  }

  public static boolean equal(Object a, Object b) {
    return a instanceof Number && b instanceof Number
        ? number(a).compareTo(number(b)) == 0
        : Objects.equals(a, b);
  }

  private static String type(Object o) {
    return o == null ? "null" : o.getClass().getSimpleName();
  }

  private static Object binary(String op, Object a, Object b) {
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
  }

  private static Object function(String name, List<Expr> args, Map<String, Object> scope) {
    tick();
    if (name.equals("COALESCE")) {
      for (Expr argument : args) {
        Object value = argument.eval(scope);
        if (value != null) return value;
      }
      return null;
    }
    if (name.equals("IF")) return args.get(bool(args.get(0).eval(scope)) ? 1 : 2).eval(scope);
    if (Set.of("ISERROR", "ISERR", "ISNA").contains(name)) {
      try {
        args.getFirst().eval(scope);
        return false;
      } catch (ArcException e) {
        boolean na = e.getMessage().contains("#N/A");
        return name.equals("ISERROR") || name.equals("ISNA") && na || name.equals("ISERR") && !na;
      }
    }
    if (name.equals("IFERROR")) {
      try {
        return args.get(0).eval(scope);
      } catch (ArcException e) {
        return args.get(1).eval(scope);
      }
    }
    if (name.equals("AND")) return args.stream().allMatch(a -> bool(a.eval(scope)));
    if (name.equals("OR")) return args.stream().anyMatch(a -> bool(a.eval(scope)));
    if (name.equals("SWITCH")) {
      Object v = args.getFirst().eval(scope);
      for (int i = 1; i + 1 < args.size(); i += 2)
        if (equal(v, args.get(i).eval(scope))) return args.get(i + 1).eval(scope);
      if (args.size() % 2 == 0) return args.getLast().eval(scope);
      throw ArcException.invalid("SWITCH has no matching case or default");
    }
    return bounded(Functions.call(name, args.stream().map(a -> a.eval(scope)).toList()));
  }

  private static int priority(String op) {
    return switch (op) {
      case "||", "OR" -> 1;
      case "&&", "AND" -> 2;
      case "==", "!=", "=", "<>" -> 3;
      case "<", "<=", ">", ">=" -> 4;
      case "+", "-" -> 5;
      case "*", "/", "%" -> 6;
      case "^" -> 8;
      default -> -1;
    };
  }

  private static final class Parser {
    private final List<String> tokens = new ArrayList<>();
    private final Set<String> variables = new HashSet<>();
    private int index, depth;
    private final Set<String> locals = new HashSet<>();

    Parser(String source) {
      var matcher = TOKEN.matcher(source);
      int position = 0;
      while (position < source.length()) {
        matcher.region(position, source.length());
        if (!matcher.lookingAt())
          throw ArcException.invalid("Invalid expression near character " + (position + 1));
        tokens.add(matcher.group().trim());
        position = matcher.end();
        if (tokens.size() > 256) throw ArcException.invalid("Expression exceeds 256 tokens");
      }
      tokens.add("<end>");
    }

    String peek() {
      return tokens.get(index);
    }

    String take() {
      return tokens.get(index++);
    }

    void expect(String token) {
      if (!peek().equals(token))
        throw ArcException.invalid("Expected '" + token + "', got '" + peek() + "'");
      take();
    }

    Expr parse(int min) {
      if (++depth > 48) throw ArcException.invalid("Expression nesting exceeds 48 levels");
      Expr left = atom();
      while (priority(peek()) >= min) {
        String op = take();
        Expr a = left, b = parse(priority(op) + (op.equals("^") ? 0 : 1));
        left =
            switch (op) {
              case "&&", "AND" -> s -> bool(a.eval(s)) && bool(b.eval(s));
              case "||", "OR" -> s -> bool(a.eval(s)) || bool(b.eval(s));
              default -> s -> binary(op, a.eval(s), b.eval(s));
            };
      }
      depth--;
      return left;
    }

    Expr atom() {
      String token = take();
      if (token.equals("<end>")) throw ArcException.invalid("Incomplete expression");
      if (token.equals("[")) {
        var items = new ArrayList<Expr>();
        if (!peek().equals("]")) {
          items.add(parse(0));
          while (peek().equals(",")) {
            take();
            items.add(parse(0));
          }
        }
        expect("]");
        return s -> bounded(items.stream().map(x -> x.eval(s)).toList());
      }
      if (token.equals("(")) {
        Expr nested = parse(0);
        expect(")");
        return nested;
      }
      if (Set.of("!", "-", "+").contains(token)) {
        Expr operand = parse(7);
        return s ->
            token.equals("!")
                ? !bool(operand.eval(s))
                : token.equals("-")
                    ? number(operand.eval(s)).negate(MATH)
                    : number(operand.eval(s));
      }
      if (token.startsWith("\"") || token.startsWith("'")) {
        StringBuilder value = new StringBuilder();
        for (int i = 1; i < token.length() - 1; i++) {
          char c = token.charAt(i);
          if (c == '\\') {
            c = token.charAt(++i);
            c =
                switch (c) {
                  case 'n' -> '\n';
                  case 't' -> '\t';
                  case 'r' -> '\r';
                  default -> c;
                };
          }
          value.append(c);
        }
        return s -> value.toString();
      }
      if (Character.isDigit(token.charAt(0)) || token.charAt(0) == '.') {
        try {
          BigDecimal n = number(new BigDecimal(token));
          return s -> n;
        } catch (NumberFormatException e) {
          throw ArcException.invalid("Invalid numeric literal");
        }
      }
      if (token.equalsIgnoreCase("true") && !peek().equals("(")) return s -> true;
      if (token.equalsIgnoreCase("false") && !peek().equals("(")) return s -> false;
      if (token.equalsIgnoreCase("null")) return s -> null;
      if (!token.matches("[A-Za-z_][A-Za-z_0-9.]*"))
        throw ArcException.invalid("Unexpected token: " + token);
      if (peek().equals("(")) {
        take();
        String name = token.toUpperCase(Locale.ROOT);
        if (Set.of("MAP", "FILTER", "ALL", "ANY", "REDUCE").contains(name)) {
          Expr collection = parse(0);
          expect(",");
          String local = take();
          if (!Validator.identifier(local))
            throw ArcException.invalid("Collection function needs a local item identifier");
          expect(",");
          String accumulator = null;
          Expr initial = null;
          if (name.equals("REDUCE")) {
            accumulator = take();
            if (!Validator.identifier(accumulator) || local.equals(accumulator))
              throw ArcException.invalid("REDUCE needs distinct item and accumulator identifiers");
            expect(",");
            initial = parse(0);
            expect(",");
          }
          var before = new HashSet<>(locals);
          locals.add(local);
          if (accumulator != null) locals.add(accumulator);
          Expr body = parse(0);
          locals.clear();
          locals.addAll(before);
          expect(")");
          String acc = accumulator;
          Expr init = initial;
          return s -> {
            var xs = Functions.array(collection.eval(s));
            var result = new ArrayList<Object>();
            Object total = init == null ? null : init.eval(s);
            for (Object item : xs) {
              tick();
              var child = new HashMap<>(s);
              child.put(local, item);
              if (acc != null) child.put(acc, total);
              Object v = body.eval(child);
              switch (name) {
                case "MAP" -> result.add(v);
                case "FILTER" -> {
                  if (bool(v)) result.add(item);
                }
                case "ALL" -> {
                  if (!bool(v)) return false;
                }
                case "ANY" -> {
                  if (bool(v)) return true;
                }
                case "REDUCE" -> total = v;
              }
            }
            return bounded(
                name.equals("REDUCE")
                    ? total
                    : name.equals("ALL") ? true : name.equals("ANY") ? false : result);
          };
        }
        var args = new ArrayList<Expr>();
        if (!peek().equals(")")) {
          args.add(parse(0));
          while (peek().equals(",")) {
            take();
            args.add(parse(0));
          }
        }
        expect(")");
        Functions.arity(name, args.size());
        return s -> function(name, args, s);
      }
      String root = token.split("\\.")[0];
      if (!locals.contains(root)) variables.add(root);
      return s -> {
        if (!s.containsKey(root)) throw ArcException.invalid("Unknown variable: " + root);
        return token.equals(root)
            ? s.get(root)
            : Functions.get(s.get(root), token.substring(root.length() + 1), null);
      };
    }
  }
}
