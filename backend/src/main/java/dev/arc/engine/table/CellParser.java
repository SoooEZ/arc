package dev.arc.engine.table;

import dev.arc.engine.Limits;
import dev.arc.engine.ValueText;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.table.CellTest.Compare.Operator;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The grammar of a condition cell:
 *
 * <pre>
 * cell    := "-" | list | "not(" list ")"
 * list    := test ("," test)*
 * test    := literal | "!=" literal | ("<" | "<=" | ">" | ">=") number | range
 * range   := number ( ".." | "..<" | "&lt;.." | "&lt;..&lt;" ) number
 * literal := number | string | true | false | null
 * </pre>
 *
 * Numbers and strings are ARC literals and read as an expression reads them ({@link Expressions}):
 * the same escapes, decimal values and bounds. Numbers never end with a dot, so {@code 5..10} is a
 * range. The scan is a loop over characters, never a backtracking pattern over a whole quoted text,
 * so a long string cannot exhaust the stack (lesson B13).
 */
final class CellParser {
  /** An optional minus, digits with optional decimals, or decimals alone, then an exponent. */
  private static final Pattern NUMBER =
      Pattern.compile("-?(?:\\d++(?:\\.\\d++)?|\\.\\d++)(?:[eE][+-]?\\d++)?");

  private static final Pattern WORD = Pattern.compile("[A-Za-z_][A-Za-z_0-9]*+");

  /** The longest part of a cell a message repeats. */
  private static final int QUOTED_CHARACTERS = 40;

  private enum Kind {
    NUMBER,
    STRING,
    WORD,
    SYMBOL,
    END
  }

  private record Token(Kind kind, String text, Object value) {
    boolean is(String symbol) {
      return kind == Kind.SYMBOL && text.equals(symbol);
    }
  }

  private final String cell;
  private final List<Token> tokens;
  private int position;

  private CellParser(String cell) {
    this.cell = cell;
    this.tokens = tokens(cell);
  }

  /** The test a cell writes; fails with a message that says what a test can be. */
  static CellTest parse(String cell) {
    String text = cell == null ? "" : cell.trim();
    if (text.isEmpty()) throw ArcException.invalid("Enter a test, or - for any value");
    Limits.requireAtMost("Test", text, Limits.MAX_EXPRESSION_CHARACTERS);
    if (text.equals("-")) return new CellTest.Any();
    return new CellParser(text).cell();
  }

  private CellTest cell() {
    CellTest test;
    Token first = peek();
    if (first.kind() == Kind.WORD && first.text().equals("not") && tokens.get(1).is("(")) {
      position += 2;
      test = new CellTest.NoneOf(list());
      expect(")");
    } else {
      List<CellTest> list = list();
      test = list.size() == 1 ? list.getFirst() : new CellTest.AnyOf(list);
    }
    if (peek().kind() != Kind.END) throw notATest();
    return test;
  }

  private List<CellTest> list() {
    var tests = new ArrayList<CellTest>();
    tests.add(test());
    while (peek().is(",")) {
      position++;
      tests.add(test());
    }
    return tests;
  }

  private CellTest test() {
    Token token = next();
    if (token.is("!=")) return new CellTest.NotEqual(literal(next()));
    Operator operator = operator(token);
    if (operator != null) return new CellTest.Compare(operator, number(next()));
    if (token.kind() == Kind.NUMBER && (peek().is("..") || peek().is("<") && peekAt(1).is("..")))
      return range((BigDecimal) token.value());
    return new CellTest.Equal(literal(token));
  }

  /** {@code low..high}, with {@code <} before the dots leaving low out, after them high. */
  private CellTest range(BigDecimal low) {
    boolean lowIncluded = !peek().is("<");
    if (!lowIncluded) position++;
    expect("..");
    boolean highIncluded = !peek().is("<");
    if (!highIncluded) position++;
    BigDecimal high = number(next());
    int order = low.compareTo(high);
    if (order > 0)
      throw ArcException.invalid(
          quoted(cell) + " is an empty range; write the smaller number first");
    if (order == 0 && !(lowIncluded && highIncluded))
      throw ArcException.invalid(
          quoted(cell) + " holds no number; write " + ValueText.text(low) + " for that value");
    return new CellTest.Range(low, lowIncluded, high, highIncluded);
  }

  private static Operator operator(Token token) {
    if (token.kind() != Kind.SYMBOL) return null;
    return switch (token.text()) {
      case "<" -> Operator.LESS;
      case "<=" -> Operator.LESS_OR_EQUAL;
      case ">" -> Operator.GREATER;
      case ">=" -> Operator.GREATER_OR_EQUAL;
      default -> null;
    };
  }

  private BigDecimal number(Token token) {
    if (token.kind() == Kind.NUMBER) return (BigDecimal) token.value();
    if (token.kind() == Kind.STRING)
      throw ArcException.invalid(
          "Comparisons and ranges take numbers; test text with \"text\", != \"text\" or not(…)");
    throw notATest();
  }

  /** A value an equality names: a number, a string, true, false or null. */
  private Object literal(Token token) {
    return switch (token.kind()) {
      case NUMBER, STRING -> token.value();
      case WORD -> wordLiteral(token.text());
      case SYMBOL, END -> throw notATest();
    };
  }

  /**
   * {@code true}, {@code false} and {@code null}, as an expression reads them; any other word would
   * be a variable, which a test cannot read, and is most often text without its quotes.
   */
  private static Object wordLiteral(String word) {
    if (word.equals(word.toLowerCase(Locale.ROOT))) {
      try {
        var compiled = Expressions.compile(word);
        if (compiled.variables().isEmpty()) return compiled.evaluate(Map.of());
      } catch (ArcException reserved) {
        // and, or: neither a value nor text in quotes.
      }
    }
    throw ArcException.invalid(
        "Write text in quotes: \"" + word + "\"; a test cannot read a variable");
  }

  private void expect(String symbol) {
    if (!next().is(symbol)) throw notATest();
  }

  private Token peek() {
    return peekAt(0);
  }

  private Token peekAt(int offset) {
    return tokens.get(Math.min(position + offset, tokens.size() - 1));
  }

  private Token next() {
    Token token = peek();
    if (position < tokens.size() - 1) position++;
    return token;
  }

  private ArcException notATest() {
    return ArcException.invalid(
        quoted(cell)
            + " is not a test. Write a value (\"gold\", 100, true or null), a comparison"
            + " (>= 100 or != \"gold\"), a range (10..20 or 10..<20), a list (\"a\", \"b\"),"
            + " not(…) or - for any value");
  }

  /** The tokens of a trimmed cell, ending with an END token. */
  private static List<Token> tokens(String cell) {
    var tokens = new ArrayList<Token>();
    int index = 0;
    while (index < cell.length()) {
      char c = cell.charAt(index);
      if (Character.isWhitespace(c)) {
        index++;
        continue;
      }
      int end;
      if (c == '"' || c == '\'') {
        end = stringEnd(cell, index);
        String text = cell.substring(index, end);
        tokens.add(new Token(Kind.STRING, text, Expressions.compile(text).evaluate(Map.of())));
      } else if ((end = matchEnd(NUMBER, cell, index)) > index) {
        String text = cell.substring(index, end);
        tokens.add(new Token(Kind.NUMBER, text, number(text)));
      } else if ((end = matchEnd(WORD, cell, index)) > index) {
        tokens.add(new Token(Kind.WORD, cell.substring(index, end), null));
      } else {
        end = symbolEnd(cell, index);
        tokens.add(new Token(Kind.SYMBOL, cell.substring(index, end), null));
      }
      index = end;
    }
    tokens.add(new Token(Kind.END, "", null));
    return tokens;
  }

  /** The decimal value of a number literal, bounded as an expression's literal is. */
  private static BigDecimal number(String text) {
    return Expressions.number(Expressions.compile(text).evaluate(Map.of()));
  }

  /** The index after a string's closing quote; a backslash escapes the next character. */
  private static int stringEnd(String cell, int start) {
    char quote = cell.charAt(start);
    int index = start + 1;
    while (index < cell.length()) {
      char c = cell.charAt(index);
      if (c == '\\') index += 2;
      else if (c == quote) return index + 1;
      else index++;
    }
    throw ArcException.invalid(quoted(cell) + " has a quote that is never closed");
  }

  private static int matchEnd(Pattern pattern, String cell, int start) {
    var matcher = pattern.matcher(cell).region(start, cell.length());
    return matcher.lookingAt() ? matcher.end() : start;
  }

  /** The symbols tests use; two-character ones first, and {@code <} alone before {@code ..}. */
  private static int symbolEnd(String cell, int start) {
    for (String symbol : List.of("!=", "<=", ">=", ".."))
      if (cell.startsWith(symbol, start)) return start + symbol.length();
    return start + 1;
  }

  /** A cell as a message repeats it: quoted, and cut after a few dozen characters. */
  static String quoted(String cell) {
    String shown =
        cell.length() <= QUOTED_CHARACTERS ? cell : cell.substring(0, QUOTED_CHARACTERS) + "…";
    return "\"" + shown + "\"";
  }
}
