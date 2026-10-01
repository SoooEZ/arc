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

  /** Comment text in source order, located at its {@code //}; a graph keeps them as notes. */
  final List<Statement> comments = new ArrayList<>();

  ArcScriptScanner(String source) {
    this.source = source;
  }

  /**
   * Whether a value written into a statement, as in {@code return value;}, scans back as that one
   * value. A ';' or '}' outside quotes and brackets, a '//' outside quotes, or an unclosed quote or
   * bracket ends the statement early, turns part of it into a comment or runs it into the next one.
   */
  static boolean scansAsOneValue(String value) {
    String statement = "value " + value;
    var scanner = new ArcScriptScanner(statement + ";");
    try {
      scanner.scan(false);
      return scanner.index == statement.length() && scanner.comments.isEmpty();
    } catch (SyntaxException endsEarlyOrNever) {
      return false;
    }
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
        comment();
        continue;
      }
      break;
    }
  }

  /** A {@code //} comment up to its line break, which stays: the comment becomes a note. */
  private void comment() {
    int start = index + 2;
    int startLine = line;
    int startColumn = column;
    while (index < source.length() && source.charAt(index) != '\n') advance();
    // The whitespace around a comment, such as the CR of a CRLF line end, is not its text.
    for (String line : ArcScriptSyntax.commentLines(source.substring(start, index).strip()))
      comments.add(new Statement(line, startLine, startColumn));
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

  /**
   * One statement or header, without its comments: a {@code //} outside quotes starts a comment
   * inside a statement as it does between statements, as the code editor shows it.
   */
  private Statement scan(boolean header) {
    whitespace();
    int startLine = line;
    int startColumn = column;
    var text = new StringBuilder();
    int copied = index;
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
      if (source.startsWith("//", index)) {
        // The blanks before a comment, or the blank line a whole-line comment leaves, go with it.
        text.append(source, copied, index);
        int end = text.length();
        while (end > 0 && Character.isWhitespace(text.charAt(end - 1))) end--;
        text.setLength(end);
        comment();
        copied = index;
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
    text.append(source, copied, index);
    return new Statement(text.toString().trim(), startLine, startColumn);
  }
}
