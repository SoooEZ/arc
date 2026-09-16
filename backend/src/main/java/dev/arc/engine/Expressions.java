package dev.arc.engine;

import dev.arc.api.ArcException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.*;
import java.util.regex.Pattern;

/** A deliberately small expression language. No reflection, scripting, IO, or arbitrary calls. */
public final class Expressions {
    public static final MathContext MATH = MathContext.DECIMAL128;
    private static final Pattern TOKEN = Pattern.compile("\\s*(?:(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.\\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')|(&&|\\|\\||==|!=|<=|>=|[+*/%<>()!,\\-]))");
    private Expressions() {}

    public interface Expr { Object eval(Map<String, Object> variables); }
    public record Compiled(Expr expr, Set<String> variables) {
        public Object evaluate(Map<String, Object> scope) { return bounded(expr.eval(scope)); }
    }
    public static Compiled compile(String source) {
        if (source == null || source.isBlank()) throw ArcException.invalid("Expression is required");
        if (source.length() > 2000) throw ArcException.invalid("Expression exceeds 2,000 characters");
        var parser = new Parser(source.trim());
        Expr expr = parser.parse(0);
        if (!parser.peek().equals("<end>")) throw ArcException.invalid("Unexpected token: " + parser.peek());
        return new Compiled(expr, Set.copyOf(parser.variables));
    }
    public static Object evaluate(String source, Map<String, Object> scope) { return compile(source).evaluate(scope); }

    public static BigDecimal number(Object value) {
        if (!(value instanceof Number)) throw ArcException.invalid("Expected a number, got " + type(value));
        try { return (BigDecimal) bounded(value instanceof BigDecimal b ? b : new BigDecimal(value.toString())); }
        catch (NumberFormatException e) { throw ArcException.invalid("Invalid numeric value"); }
    }
    public static boolean bool(Object value) {
        if (!(value instanceof Boolean b)) throw ArcException.invalid("Expected a boolean, got " + type(value));
        return b;
    }
    public static Object bounded(Object value) {
        if (value instanceof BigDecimal n && (n.precision() > 100 || Math.abs((long)n.scale()) > 100))
            throw ArcException.invalid("Number exceeds supported precision or magnitude");
        if (value instanceof String s && s.length() > 2000) throw ArcException.invalid("String exceeds 2,000 characters");
        return value;
    }
    private static String type(Object o) { return o == null ? "null" : o.getClass().getSimpleName(); }

    private static Object binary(String op, Object a, Object b) {
        if (op.equals("==") || op.equals("!=")) {
            boolean same = a instanceof Number && b instanceof Number ? number(a).compareTo(number(b)) == 0 : Objects.equals(a, b);
            return op.equals("==") == same;
        }
        if (Set.of("<", "<=", ">", ">=").contains(op)) {
            int cmp;
            if (a instanceof String x && b instanceof String y) cmp = x.compareTo(y);
            else cmp = number(a).compareTo(number(b));
            return switch (op) { case "<" -> cmp < 0; case "<=" -> cmp <= 0; case ">" -> cmp > 0; default -> cmp >= 0; };
        }
        BigDecimal x = number(a), y = number(b);
        if ((op.equals("/") || op.equals("%")) && y.signum() == 0) throw ArcException.invalid("Division by zero");
        return bounded(switch (op) {
            case "+" -> x.add(y, MATH); case "-" -> x.subtract(y, MATH);
            case "*" -> x.multiply(y, MATH); case "/" -> x.divide(y, MATH);
            case "%" -> x.remainder(y, MATH); default -> throw ArcException.invalid("Unknown operator: " + op);
        });
    }
    private static Object function(String name, List<Expr> args, Map<String, Object> scope) {
        if (name.equals("if")) return args.get(bool(args.get(0).eval(scope)) ? 1 : 2).eval(scope);
        List<BigDecimal> numbers = args.stream().map(a -> number(a.eval(scope))).toList();
        BigDecimal n = numbers.getFirst();
        return bounded(switch (name) {
            case "min" -> numbers.stream().min(BigDecimal::compareTo).orElseThrow();
            case "max" -> numbers.stream().max(BigDecimal::compareTo).orElseThrow();
            case "abs" -> n.abs(MATH);
            case "floor" -> n.setScale(0, RoundingMode.FLOOR);
            case "ceil" -> n.setScale(0, RoundingMode.CEILING);
            case "round" -> {
                int scale;
                try { scale = numbers.get(1).intValueExact(); }
                catch (ArithmeticException e) { throw ArcException.invalid("round precision must be an integer from 0 to 12"); }
                if (scale < 0 || scale > 12) throw ArcException.invalid("round precision must be an integer from 0 to 12");
                yield n.setScale(scale, RoundingMode.HALF_UP);
            }
            default -> throw ArcException.invalid("Unknown function: " + name);
        });
    }
    private static int priority(String op) {
        return switch (op) { case "||" -> 1; case "&&" -> 2; case "==", "!=" -> 3;
            case "<", "<=", ">", ">=" -> 4; case "+", "-" -> 5; case "*", "/", "%" -> 6; default -> -1; };
    }
    private static final class Parser {
        private final List<String> tokens = new ArrayList<>();
        private final Set<String> variables = new HashSet<>();
        private int index, depth;
        Parser(String source) {
            var matcher = TOKEN.matcher(source);
            int position = 0;
            while (position < source.length()) {
                matcher.region(position, source.length());
                if (!matcher.lookingAt()) throw ArcException.invalid("Invalid expression near character " + (position + 1));
                tokens.add(matcher.group().trim()); position = matcher.end();
                if (tokens.size() > 256) throw ArcException.invalid("Expression exceeds 256 tokens");
            }
            tokens.add("<end>");
        }
        String peek() { return tokens.get(index); }
        String take() { return tokens.get(index++); }
        void expect(String token) { if (!peek().equals(token)) throw ArcException.invalid("Expected '" + token + "', got '" + peek() + "'"); take(); }
        Expr parse(int min) {
            if (++depth > 48) throw ArcException.invalid("Expression nesting exceeds 48 levels");
            Expr left = atom();
            while (priority(peek()) >= min) {
                String op = take(); Expr a = left, b = parse(priority(op) + 1);
                left = switch (op) {
                    case "&&" -> s -> bool(a.eval(s)) && bool(b.eval(s));
                    case "||" -> s -> bool(a.eval(s)) || bool(b.eval(s));
                    default -> s -> binary(op, a.eval(s), b.eval(s));
                };
            }
            depth--; return left;
        }
        Expr atom() {
            String token = take();
            if (token.equals("<end>")) throw ArcException.invalid("Incomplete expression");
            if (token.equals("(")) { Expr nested = parse(0); expect(")"); return nested; }
            if (Set.of("!", "-", "+").contains(token)) {
                Expr operand = parse(7);
                return s -> token.equals("!") ? !bool(operand.eval(s)) : token.equals("-") ? number(operand.eval(s)).negate(MATH) : number(operand.eval(s));
            }
            if (token.startsWith("\"") || token.startsWith("'")) {
                StringBuilder value = new StringBuilder();
                for (int i = 1; i < token.length() - 1; i++) {
                    char c = token.charAt(i);
                    if (c == '\\') { c = token.charAt(++i); c = switch(c) { case 'n' -> '\n'; case 't' -> '\t'; case 'r' -> '\r'; default -> c; }; }
                    value.append(c);
                }
                return s -> value.toString();
            }
            if (Character.isDigit(token.charAt(0)) || token.charAt(0) == '.') {
                try { BigDecimal n = number(new BigDecimal(token)); return s -> n; }
                catch (NumberFormatException e) { throw ArcException.invalid("Invalid numeric literal"); }
            }
            if (token.equals("true")) return s -> true;
            if (token.equals("false")) return s -> false;
            if (token.equals("null")) return s -> null;
            if (!token.matches("[A-Za-z_][A-Za-z_0-9]*")) throw ArcException.invalid("Unexpected token: " + token);
            if (peek().equals("(")) {
                take(); var args = new ArrayList<Expr>();
                if (!peek().equals(")")) { args.add(parse(0)); while (peek().equals(",")) { take(); args.add(parse(0)); } }
                expect(")");
                int count = args.size();
                boolean valid = switch (token) {
                    case "min", "max" -> count >= 2 && count <= 10;
                    case "abs", "floor", "ceil" -> count == 1; case "round" -> count == 2; case "if" -> count == 3;
                    default -> throw ArcException.invalid("Unknown function: " + token);
                };
                if (!valid) throw ArcException.invalid("Invalid argument count for " + token);
                return s -> function(token, args, s);
            }
            variables.add(token);
            return s -> {
                if (!s.containsKey(token)) throw ArcException.invalid("Unknown variable: " + token);
                return s.get(token);
            };
        }
    }
}
