package dev.arc.engine.expression;

import static dev.arc.engine.expression.Expressions.*;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import dev.arc.engine.Identifiers;
import dev.arc.engine.expression.Expressions.Expr;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;

/** ARC grammar and lexical dependencies. Compilation never evaluates values or fetches data. */
final class ExpressionParser {
  // Preserve ARC's single quotes, unknown escapes and literal controls while sharing JSON's
  // Unicode/control-character decoder. These options never affect HTTP or stored JSON parsing.
  private static final JsonFactory STRINGS =
      JsonFactory.builder()
          .enable(JsonReadFeature.ALLOW_SINGLE_QUOTES)
          .enable(JsonReadFeature.ALLOW_BACKSLASH_ESCAPING_ANY_CHARACTER)
          .enable(JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS)
          .build();
  private static final Pattern TOKEN =
      Pattern.compile(
          "\\s*(?:(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.\\d+)|(\\$?[A-Za-z_][A-Za-z_0-9.]*|@[A-Za-z_][A-Za-z_0-9-]*(?::[0-9]+)?)|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')|(&&|\\|\\||==|!=|<>|<=|>=|[=^\\[\\]+*/%<>()!,\\-]))");

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

  private final List<String> tokens = new ArrayList<>();
  private final Set<String> variables = new HashSet<>();
  private final List<FormulaCall> formulaCalls = new ArrayList<>();
  private int index, depth;
  private final Set<String> locals = new HashSet<>();

  ExpressionParser(String source) {
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

  Expr parse(int minimumPriority) {
    if (++depth > 48) throw ArcException.invalid("Expression nesting exceeds 48 levels");
    Expr left = atom();
    while (priority(peek()) >= minimumPriority) {
      String operator = take();
      Expr leftOperand = left;
      // Power associates right-to-left; all other binary operators associate left-to-right.
      int nextPriority = priority(operator) + (operator.equals("^") ? 0 : 1);
      Expr rightOperand = parse(nextPriority);
      left =
          switch (operator) {
            case "&&", "AND" ->
                context -> bool(leftOperand.eval(context)) && bool(rightOperand.eval(context));
            case "||", "OR" ->
                context -> bool(leftOperand.eval(context)) || bool(rightOperand.eval(context));
            default ->
                context ->
                    ExpressionRuntime.binary(
                        operator, leftOperand.eval(context), rightOperand.eval(context));
          };
    }
    depth--;
    return left;
  }

  private Expr atom() {
    String token = take();
    if (token.equals("<end>")) throw ArcException.invalid("Incomplete expression");
    if (token.equals("[")) {
      List<Expr> items = arguments("]");
      return context -> bounded(items.stream().map(item -> item.eval(context)).toList());
    }
    if (token.equals("(")) {
      Expr nested = parse(0);
      expect(")");
      return nested;
    }
    if (Set.of("!", "-", "+").contains(token)) {
      Expr operand = parse(7);
      return switch (token) {
        case "!" -> context -> !bool(operand.eval(context));
        case "-" -> context -> number(operand.eval(context)).negate(MATH);
        default -> context -> number(operand.eval(context));
      };
    }
    if (token.startsWith("\"") || token.startsWith("'")) {
      String value = stringLiteral(token);
      return context -> value;
    }
    if (Character.isDigit(token.charAt(0)) || token.charAt(0) == '.') {
      try {
        BigDecimal value = number(new BigDecimal(token));
        return context -> value;
      } catch (NumberFormatException error) {
        throw ArcException.invalid("Invalid numeric literal");
      }
    }
    if (token.equalsIgnoreCase("true") && !peek().equals("(")) return context -> true;
    if (token.equalsIgnoreCase("false") && !peek().equals("(")) return context -> false;
    if (token.equalsIgnoreCase("null")) return context -> null;
    if (token.startsWith("@")) return formulaCall(token);
    if (!token.matches("\\$?[A-Za-z_][A-Za-z_0-9.]*"))
      throw ArcException.invalid("Unexpected token: " + token);
    if (peek().equals("(")) return functionCall(token);
    if (token.startsWith("$"))
      throw ArcException.invalid("Function name must be followed by '(': " + token);
    return variable(token);
  }

  private Expr variable(String path) {
    String root = path.split("\\.")[0];
    if (!locals.contains(root)) variables.add(root);
    return context -> {
      Object value = context.variable(root);
      return path.equals(root)
          ? value
          : Functions.get(value, path.substring(root.length() + 1), null);
    };
  }

  private Expr functionCall(String token) {
    if (!token.startsWith("$"))
      throw ArcException.invalid(
          "Function calls require a $ prefix; use $" + token.toUpperCase(Locale.ROOT) + "(...)");
    expect("(");
    String name = token.substring(1).toUpperCase(Locale.ROOT);
    if (Set.of("MAP", "FILTER", "ALL", "ANY", "REDUCE").contains(name)) return collectionCall(name);
    List<Expr> arguments = arguments(")");
    Functions.arity(name, arguments.size());
    return context -> ExpressionRuntime.function(name, arguments, context);
  }

  private Expr formulaCall(String token) {
    int separator = token.indexOf(':');
    if (separator < 0)
      throw ArcException.invalid("Formula calls require a pinned version: @rule-id:1(...)");
    String id = token.substring(1, separator);
    if (!id.matches("[a-z][a-z0-9-]{0,79}"))
      throw ArcException.invalid("Formula call needs a valid rule ID");
    int version;
    try {
      if (!token.substring(separator + 1).matches("[1-9][0-9]*")) throw new NumberFormatException();
      version = Integer.parseInt(token.substring(separator + 1));
      if (version <= 0) throw new NumberFormatException();
    } catch (NumberFormatException error) {
      throw ArcException.invalid("Formula call version must be a positive integer");
    }
    expect("(");
    int callIndex = formulaCalls.size();
    List<Expr> arguments = arguments(")");
    var formula = new FormulaCall(id, version, arguments.size());
    formulaCalls.add(callIndex, formula);
    return context -> ExpressionRuntime.formula(formula, arguments, context);
  }

  private Expr collectionCall(String name) {
    Expr collection = parse(0);
    expect(",");
    String local = take();
    if (!Identifiers.isValid(local))
      throw ArcException.invalid("Collection function needs a local item identifier");
    expect(",");
    String accumulator = null;
    Expr initial = null;
    if (name.equals("REDUCE")) {
      accumulator = take();
      if (!Identifiers.isValid(accumulator) || local.equals(accumulator))
        throw ArcException.invalid("REDUCE needs distinct item and accumulator identifiers");
      expect(",");
      initial = parse(0);
      expect(",");
    }
    var outerLocals = new HashSet<>(locals);
    locals.add(local);
    if (accumulator != null) locals.add(accumulator);
    Expr body = parse(0);
    locals.clear();
    locals.addAll(outerLocals);
    expect(")");
    String accumulatorName = accumulator;
    Expr initialValue = initial;
    return context ->
        ExpressionRuntime.collection(
            name, collection, local, accumulatorName, initialValue, body, context);
  }

  private List<Expr> arguments(String closingToken) {
    var expressions = new ArrayList<Expr>();
    if (!peek().equals(closingToken)) {
      expressions.add(parse(0));
      while (peek().equals(",")) {
        take();
        expressions.add(parse(0));
      }
    }
    expect(closingToken);
    return List.copyOf(expressions);
  }

  private String stringLiteral(String token) {
    try (var parser = STRINGS.createParser(token)) {
      if (parser.nextToken() != JsonToken.VALUE_STRING)
        throw ArcException.invalid("Expected a string literal");
      String value = parser.getText();
      if (parser.nextToken() != null)
        throw ArcException.invalid("Unexpected text after string literal");
      return value;
    } catch (java.io.IOException error) {
      // Tokenization already checked the quotes. Malformed Unicode escapes remain ARC errors.
      throw ArcException.invalid("Unicode escape needs four hexadecimal digits");
    }
  }

  Set<String> variables() {
    return variables;
  }

  List<FormulaCall> formulaCalls() {
    return formulaCalls;
  }
}
