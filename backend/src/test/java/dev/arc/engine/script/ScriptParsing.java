package dev.arc.engine.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition;

/**
 * Parses whole-graph ARC Script for tests, without the facade's draft-shape check and without the
 * build's diagnostics: a syntax error throws {@link ArcScriptScanner.SyntaxException}, as the
 * removed {@code ArcScript.parse} did. Production code reads scripts through {@link
 * ArcScript#build}.
 */
public final class ScriptParsing {
  private ScriptParsing() {}

  public static Definition parse(String source) {
    return new ArcScriptParser(new ObjectMapper()).parse(source).definition();
  }
}
