package dev.arc.engine.script;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;

/** Shared lexical forms and strict JSON literals with statement-local diagnostics. */
final class ArcScriptSyntax {
  static final String ID = "(\"(?:[^\"\\\\]|\\\\.)*\"|[A-Za-z_][A-Za-z_0-9-]*)";

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

  static SyntaxException error(String message, Statement statement) {
    return new SyntaxException(message, statement.line(), statement.column());
  }
}
