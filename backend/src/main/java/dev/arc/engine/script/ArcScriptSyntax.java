package dev.arc.engine.script;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Shared lexical forms and strict JSON literals with statement-local diagnostics. */
final class ArcScriptSyntax {
  /**
   * A double-quoted JSON string. The quantifiers are possessive: java.util.regex recurses once per
   * repetition of a backtracking group, so a long quoted name used to overflow the stack.
   */
  static final String QUOTED = "\"[^\"\\\\]*+(?:\\\\.[^\"\\\\]*+)*+\"";

  /** A quoted name or a bare one; bare names may contain hyphens. */
  static final String ID = "(" + QUOTED + "|[A-Za-z_][A-Za-z_0-9-]*)";

  /** Any line break ({@code \\R}): CRLF, LF, CR, vertical tab, form feed, NEL, U+2028, U+2029. */
  static final Pattern LINE_BREAK = Pattern.compile("\\R");

  /**
   * The comments a note takes: one per line, each without surrounding whitespace. The renderer
   * starts a comment at every line break in a note and the scanner splits a comment at the breaks
   * other than the newline that ends it, so building canonical text returns the notes a save stores
   * (lesson B12).
   */
  static List<String> commentLines(String text) {
    var lines = new ArrayList<String>();
    for (String line : LINE_BREAK.split(text, -1)) lines.add(line.strip());
    return lines;
  }

  private final ObjectMapper json;

  ArcScriptSyntax(ObjectMapper json) {
    this.json = json;
  }

  <T> T read(String text, Class<T> type, Statement statement) {
    try {
      return json.readerFor(type)
          .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .readValue(text);
    } catch (JsonProcessingException failure) {
      throw error("Invalid JSON literal or source binding", statement);
    }
  }

  String unquote(String text, Statement statement) {
    return text.startsWith("\"") ? read(text, String.class, statement) : text;
  }

  static String identifier(String text, Statement statement) {
    if (!Identifiers.isValid(text))
      throw error(
          "Names must be identifiers (letters, digits, underscores; max "
              + Limits.MAX_IDENTIFIER_CHARACTERS
              + ")",
          statement);
    return text;
  }

  static SyntaxException error(String message, Statement statement) {
    return new SyntaxException(message, statement.line(), statement.column());
  }
}
