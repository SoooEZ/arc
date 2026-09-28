package dev.arc.engine.script;

import static dev.arc.engine.script.ArcScriptSyntax.error;
import static dev.arc.engine.script.ArcScriptSyntax.identifier;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.InputTypes;
import dev.arc.engine.Limits;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.engine.script.ArcScriptScanner.SyntaxException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.IntFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Document declarations and input schemas; each node owns a separate grammar session. */
final class ArcScriptParser {
  private static final String TYPES = String.join("|", InputTypes.NAMES);
  private static final Pattern INPUT =
      Pattern.compile(
          "([A-Za-z_][A-Za-z_0-9]*)\\s*:\\s*("
              + TYPES
              + ")\\s+(required|optional)(?:\\s+default\\s+(.+))?",
          Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  private static final Pattern SOURCE =
      Pattern.compile("source\\s+(\\w+)\\s*=\\s*(.+)", Pattern.DOTALL);

  /** A parsed document and the statements that declared its elements. */
  record Parsed(Definition definition, ScriptLocations locations) {}

  private record Declared<T>(T value, Statement statement) {}

  private final ArcScriptSyntax syntax;

  ArcScriptParser(ObjectMapper json) {
    this.syntax = new ArcScriptSyntax(json);
  }

  /** A whole graph: a node written without {@code at (x, y)} takes a grid position. */
  Parsed parse(String source) {
    return parse(source, ArcScriptParser::gridPosition);
  }

  /**
   * One node's code: a header without {@code at (x, y)} keeps {@code position}, the node's place in
   * the containing graph, instead of the grid's first cell.
   */
  Parsed parseFragment(String source, Position position) {
    return parse(source, index -> position);
  }

  /** A whole graph places nodes written without a position in three columns of cards. */
  private static Position gridPosition(int index) {
    return new Position((index % 3) * 300, (index / 3) * 170);
  }

  private Parsed parse(String source, IntFunction<Position> fallbackPositions) {
    // HTTP also bounds the encoded request bytes. Keep a separate bound for embedded callers;
    // the former 100,000-character limit rejected otherwise valid graph/code round trips.
    if (source == null || source.length() > Limits.MAX_SCRIPT_CHARACTERS)
      throw new SyntaxException(
          "Source must be at most " + Limits.format(Limits.MAX_SCRIPT_CHARACTERS) + " characters",
          1,
          1);
    var scanner = new ArcScriptScanner(source);
    var locations = new ScriptLocations();
    var inputs = new ArrayList<Declared<Input>>();
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    Map<String, Declared<SourceBinding>> sources = new LinkedHashMap<>();
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
        var nodeParser =
            new ArcScriptNodeParser(syntax, header, scanner, fallbackPositions.apply(nodes.size()));
        nodes.add(nodeParser.parse(scanner, edges, locations));
      }
    }
    locations.commented(scanner.comments);
    var notes = scanner.comments.stream().map(Statement::text).toList();
    var connectedInputs = attachSources(inputs, sources, locations);
    return new Parsed(new Definition(1, connectedInputs, nodes, edges, notes), locations);
  }

  private List<Input> attachSources(
      List<Declared<Input>> inputs,
      Map<String, Declared<SourceBinding>> sources,
      ScriptLocations locations) {
    for (var source : sources.entrySet())
      if (inputs.stream().noneMatch(input -> input.value().name().equals(source.getKey())))
        throw error(
            "Source refers to unknown input: " + source.getKey(), source.getValue().statement());
    var connectedInputs = new ArrayList<Input>();
    for (var declared : inputs) {
      Input input = declared.value();
      var source = sources.get(input.name());
      var connected =
          new Input(
              input.name(),
              input.type(),
              input.required(),
              input.defaultValue(),
              source == null ? null : source.value());
      locations.declared(connected, declared.statement());
      if (source != null) locations.sourced(connected, source.statement());
      connectedInputs.add(connected);
    }
    return connectedInputs;
  }

  private void parseInputs(
      List<Statement> statements,
      List<Declared<Input>> inputs,
      Map<String, Declared<SourceBinding>> sources) {
    for (Statement statement : statements) {
      if (statement.text().startsWith("source ")) {
        Matcher match = SOURCE.matcher(statement.text());
        if (!match.matches())
          throw error("Use: source parameter = { JSON source binding };", statement);
        var binding = syntax.read(match.group(2), SourceBinding.class, statement);
        if (sources.putIfAbsent(
                identifier(match.group(1), statement), new Declared<>(binding, statement))
            != null) throw error("Duplicate input source", statement);
      } else {
        Matcher match = INPUT.matcher(statement.text());
        if (!match.matches())
          throw error("Use: parameter: " + TYPES + " required|optional [default JSON];", statement);
        var input =
            new Input(
                identifier(match.group(1), statement),
                match.group(2).toUpperCase(Locale.ROOT),
                match.group(3).equalsIgnoreCase("required"),
                match.group(4) == null
                    ? null
                    : syntax.read(match.group(4), Object.class, statement));
        inputs.add(new Declared<>(input, statement));
      }
    }
  }
}
