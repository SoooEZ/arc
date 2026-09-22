package dev.arc.engine.script;

import static dev.arc.engine.script.ArcScriptSyntax.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Document declarations and input schemas; each node owns a separate grammar session. */
final class ArcScriptParser {
  private static final int MAX_SOURCE_CHARACTERS = 1_048_576;
  private static final Pattern INPUT =
      Pattern.compile(
          "([A-Za-z_][A-Za-z_0-9]*)\\s*:\\s*(NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\\s+(required|optional)(?:\\s+default\\s+(.+))?",
          Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  private static final Pattern SOURCE =
      Pattern.compile("source\\s+(\\w+)\\s*=\\s*(.+)", Pattern.DOTALL);

  private final ArcScriptSyntax syntax;

  ArcScriptParser(ObjectMapper json) {
    this.syntax = new ArcScriptSyntax(json);
  }

  Definition parse(String source) {
    // HTTP also bounds the encoded request bytes. Keep a separate bound for embedded callers;
    // the former 100,000-character limit rejected otherwise valid graph/code round trips.
    if (source == null || source.length() > MAX_SOURCE_CHARACTERS)
      throw new SyntaxException("Source must be at most 1,048,576 characters", 1, 1);
    var scanner = new ArcScriptScanner(source);
    var inputs = new ArrayList<Input>();
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    Map<String, SourceBinding> sources = new HashMap<>();
    boolean inputBlock = false;
    while (scanner.more()) {
      Statement header = scanner.readHeader();
      if (header.text().equalsIgnoreCase("schema 1")) {
        scanner.expect(';');
      } else if (header.text().equalsIgnoreCase("inputs")) {
        if (inputBlock) throw error("Only one inputs block is allowed", header);
        inputBlock = true;
        scanner.expect('{');
        parseInputs(scanner.body(), inputs, sources);
      } else {
        var nodeParser = new ArcScriptNodeParser(syntax, header, scanner, nodes.size());
        nodes.add(nodeParser.parse(scanner, edges));
      }
    }
    return new Definition(1, attachSources(inputs, sources), nodes, edges, scanner.notes);
  }

  private List<Input> attachSources(List<Input> inputs, Map<String, SourceBinding> sources) {
    for (String name : sources.keySet())
      if (inputs.stream().noneMatch(input -> input.name().equals(name)))
        throw new SyntaxException("Source refers to unknown input: " + name, 1, 1);
    var connectedInputs = new ArrayList<Input>();
    for (Input input : inputs) {
      connectedInputs.add(
          new Input(
              input.name(),
              input.type(),
              input.required(),
              input.defaultValue(),
              sources.get(input.name())));
    }
    return connectedInputs;
  }

  private void parseInputs(
      List<Statement> statements, List<Input> inputs, Map<String, SourceBinding> sources) {
    for (Statement statement : statements) {
      if (statement.text().startsWith("source ")) {
        Matcher match = SOURCE.matcher(statement.text());
        if (!match.matches())
          throw error("Use: source parameter = { JSON source binding };", statement);
        if (sources.putIfAbsent(
                match.group(1), syntax.read(match.group(2), SourceBinding.class, statement))
            != null) throw error("Duplicate input source", statement);
      } else {
        Matcher match = INPUT.matcher(statement.text());
        if (!match.matches())
          throw error(
              "Use: parameter: NUMBER|STRING|BOOLEAN|ARRAY|OBJECT required|optional [default"
                  + " JSON];",
              statement);
        inputs.add(
            new Input(
                match.group(1),
                match.group(2).toUpperCase(Locale.ROOT),
                match.group(3).equalsIgnoreCase("required"),
                match.group(4) == null
                    ? null
                    : syntax.read(match.group(4), Object.class, statement)));
      }
    }
  }
}
