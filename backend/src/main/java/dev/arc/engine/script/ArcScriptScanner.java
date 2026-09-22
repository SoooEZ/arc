package dev.arc.engine.script;

import java.util.ArrayList;
import java.util.List;

/** Token boundaries and source locations for ARC Script; expression syntax stays in Expressions. */
final class ArcScriptScanner {
  record Statement(String text, int line, int column) {}

  static final class SyntaxException extends RuntimeException {
    final int line;
    final int column;

    SyntaxException(String message, int line, int column) {
      super(message);
      this.line = line;
      this.column = column;
    }
  }

  private final String source;
  private int index;
  private int line = 1;
  private int column = 1;
  final List<String> notes = new ArrayList<>();

  ArcScriptScanner(String source) {
    this.source = source;
  }

  private void advance() {
    if (source.charAt(index++) == '\n') {
      line++;
      column = 1;
    } else column++;
  }

  private void whitespace() {
    while (index < source.length()) {
      if (Character.isWhitespace(source.charAt(index))) {
        advance();
        continue;
      }
      if (source.startsWith("//", index)) {
        int start = index + 2;
        while (index < source.length() && source.charAt(index) != '\n') advance();
        notes.add(source.substring(start, index).strip());
        continue;
      }
      break;
    }
  }

  boolean more() {
    whitespace();
    return index < source.length();
  }

  void expect(char c) {
    whitespace();
    if (index >= source.length() || source.charAt(index) != c)
      throw new SyntaxException("Expected '" + c + "'", line, column);
    advance();
  }

  Statement readHeader() {
    return scan(true);
  }

  List<Statement> body() {
    var list = new ArrayList<Statement>();
    while (more() && source.charAt(index) != '}') {
      list.add(scan(false));
      expect(';');
    }
    expect('}');
    return list;
  }

  private Statement scan(boolean header) {
    whitespace();
    int start = index;
    int startLine = line;
    int startColumn = column;
    int nesting = 0;
    char quote = 0;
    boolean escape = false;
    while (index < source.length()) {
      char c = source.charAt(index);
      if (quote != 0) {
        if (escape) escape = false;
        else if (c == '\\') escape = true;
        else if (c == quote) quote = 0;
        advance();
        continue;
      }
      if (c == '\"' || c == '\'') {
        quote = c;
        advance();
        continue;
      }
      if (header && (c == '{' || c == ';')) break;
      if (!header && nesting == 0 && c == ';') break;
      if (!header && nesting == 0 && c == '}')
        throw new SyntaxException("Statement must end with ';'", line, column);
      if (c == '{' || c == '[' || c == '(') nesting++;
      if (c == '}' || c == ']' || c == ')') nesting--;
      advance();
    }
    if (quote != 0 || index >= source.length())
      throw new SyntaxException("Unfinished statement or quoted string", startLine, startColumn);
    return new Statement(source.substring(start, index).trim(), startLine, startColumn);
  }
}
