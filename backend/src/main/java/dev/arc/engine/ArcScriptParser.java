package dev.arc.engine;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ArcScriptScanner.Statement;
import dev.arc.engine.ArcScriptScanner.SyntaxException;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.regex.*;

/** Converts script statements to graph data; executable-graph validation belongs to Validator. */
final class ArcScriptParser {
  private final ObjectMapper json;

  ArcScriptParser(ObjectMapper json) {
    this.json = json;
  }

  private static final String ID = "(\"(?:[^\"\\\\]|\\\\.)*\"|[A-Za-z_][A-Za-z_0-9-]*)";
  private static final Pattern HEADER =
      Pattern.compile(
          "node\\s+"
              + ID
              + "\\s+(INPUT|FORMULA|CONDITION|SWITCH|TRANSFORM|REFERENCE|OUTPUT)\\s+(\"(?:[^\"\\\\]|\\\\.)*\")(?:\\s+at\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*\\))?",
          Pattern.CASE_INSENSITIVE);
  private static final Pattern INPUT =
      Pattern.compile(
          "([A-Za-z_][A-Za-z_0-9]*)\\s*:\\s*(NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\\s+(required|optional)(?:\\s+default\\s+(.+))?",
          Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  private static final Pattern EDGE =
      Pattern.compile(
          "(next|true|false|default|case:[A-Za-z0-9_-]{1,64})\\s*->\\s*"
              + ID
              + "(?:\\s+edge\\s+"
              + ID
              + ")?",
          Pattern.CASE_INSENSITIVE);
  private static final Pattern CASE =
      Pattern.compile("case\\s+" + ID + "\\s+" + ID + "\\s+when\\s+(.+)", Pattern.DOTALL);
  private static final Pattern FIELD =
      Pattern.compile("field\\s+" + ID + "\\s*=\\s*(.+)", Pattern.DOTALL);

  private static final Pattern SOURCE =
      Pattern.compile("source\\s+(\\w+)\\s*=\\s*(.+)", Pattern.DOTALL);
  private static final Pattern ASSIGNMENT =
      Pattern.compile("([A-Za-z_][A-Za-z_0-9]*)\\s*=\\s*(.+)", Pattern.DOTALL);
  private static final Pattern REFERENCE =
      Pattern.compile("use\\s+" + ID + "\\s+version\\s+([1-9]\\d*)");

  Definition parse(String source) {
    if (source == null || source.length() > 100_000)
      throw new SyntaxException("Source must be at most 100,000 characters", 1, 1);
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
        continue;
      }
      if (header.text().equalsIgnoreCase("inputs")) {
        if (inputBlock) throw error("Only one inputs block is allowed", header);
        inputBlock = true;
        scanner.expect('{');
        parseInputs(scanner.body(), inputs, sources);
        continue;
      }
      nodes.add(parseNode(header, scanner, nodes.size(), edges));
    }
    for (String name : sources.keySet())
      if (inputs.stream().noneMatch(input -> input.name().equals(name)))
        throw new SyntaxException("Source refers to unknown input: " + name, 1, 1);
    return new Definition(
        1,
        inputs.stream()
            .map(
                input ->
                    new Input(
                        input.name(),
                        input.type(),
                        input.required(),
                        input.defaultValue(),
                        sources.get(input.name())))
            .toList(),
        nodes,
        edges,
        scanner.notes);
  }

  private void parseInputs(
      List<Statement> statements, List<Input> inputs, Map<String, SourceBinding> sources) {
    for (Statement statement : statements) {
      if (statement.text().startsWith("source ")) {
        Matcher match = SOURCE.matcher(statement.text());
        if (!match.matches())
          throw error("Use: source parameter = { JSON source binding };", statement);
        if (sources.putIfAbsent(
                match.group(1), read(match.group(2), SourceBinding.class, statement))
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
                match.group(4) == null ? null : read(match.group(4), Object.class, statement)));
      }
    }
  }

  private Node parseNode(
      Statement header, ArcScriptScanner scanner, int nodeIndex, List<Edge> edges) {
    Matcher headerMatch = HEADER.matcher(header.text());
    if (!headerMatch.matches())
      throw error("Expected inputs { ... } or node id TYPE \"Label\" [at (x, y)] { ... }", header);
    scanner.expect('{');
    String id = unquote(headerMatch.group(1), header);
    String type = headerMatch.group(2).toUpperCase(Locale.ROOT);
    String label = unquote(headerMatch.group(3), header);
    Position position =
        headerMatch.group(4) == null
            ? new Position((nodeIndex % 3) * 300, (nodeIndex / 3) * 170)
            : new Position(
                Double.parseDouble(headerMatch.group(4)), Double.parseDouble(headerMatch.group(5)));
    String expression = null;
    String output = null;
    String ruleId = null;
    Integer version = null;
    var bindings = new LinkedHashMap<String, String>();
    var cases = new ArrayList<BranchCase>();
    var fields = new ArrayList<Field>();
    var assigned = new HashSet<String>();
    for (Statement statement : scanner.body()) {
      String text = statement.text();
      Matcher edge = EDGE.matcher(text);
      if (edge.matches()) {
        String rawHandle = edge.group(1);
        String handle =
            rawHandle.toLowerCase(Locale.ROOT).startsWith("case:")
                ? "case:" + rawHandle.substring(5)
                : rawHandle.toLowerCase(Locale.ROOT);
        String target = unquote(edge.group(2), statement);
        unique(assigned, handle + ":" + target, statement);
        edges.add(
            new Edge(
                edge.group(3) == null
                    ? id + "-" + handle + "-" + target
                    : unquote(edge.group(3), statement),
                id,
                target,
                handle));
        continue;
      }
      if (text.startsWith("let ") && (type.equals("FORMULA") || type.equals("TRANSFORM"))) {
        var assignment = assignment(text.substring(4), statement);
        unique(assigned, "expression", statement);
        unique(assigned, "as", statement);
        output = assignment.variable();
        expression = assignment.expression();
        checkExpression(expression, statement);
      } else if (text.startsWith("case ") && type.equals("SWITCH")) {
        var option = CASE.matcher(text);
        if (!option.matches()) throw error("Use: case id \"Label\" when expression;", statement);
        String caseId = unquote(option.group(1), statement);
        unique(assigned, "case:" + caseId, statement);
        checkExpression(option.group(3), statement);
        cases.add(
            new BranchCase(caseId, unquote(option.group(2), statement), option.group(3).trim()));
      } else if (text.startsWith("field ") && type.equals("TRANSFORM")) {
        var field = FIELD.matcher(text);
        if (!field.matches()) throw error("Use: field \"name\" = expression;", statement);
        String fieldName = unquote(field.group(1), statement);
        unique(assigned, "field:" + fieldName, statement);
        checkExpression(field.group(2), statement);
        fields.add(new Field(fieldName, field.group(2).trim()));
      } else if (text.startsWith("when ") && type.equals("CONDITION")) {
        unique(assigned, "expression", statement);
        expression = text.substring(5).trim();
        checkExpression(expression, statement);
      } else if (text.startsWith("return ") && type.equals("OUTPUT")) {
        unique(assigned, "expression", statement);
        expression = text.substring(7).trim();
        checkExpression(expression, statement);
      } else if (text.startsWith("use ") && type.equals("REFERENCE")) {
        var use = REFERENCE.matcher(text);
        if (!use.matches()) throw error("Use: use \"rule-id\" version 1;", statement);
        unique(assigned, "use", statement);
        ruleId = unquote(use.group(1), statement);
        try {
          version = Integer.parseInt(use.group(2));
        } catch (NumberFormatException e) {
          throw error("Version is too large", statement);
        }
      } else if (text.startsWith("bind ") && type.equals("REFERENCE")) {
        var assignment = assignment(text.substring(5), statement);
        unique(assigned, "bind:" + assignment.variable(), statement);
        checkExpression(assignment.expression(), statement);
        bindings.put(assignment.variable(), assignment.expression());
      } else if (text.startsWith("as ") && (type.equals("REFERENCE") || type.equals("TRANSFORM"))) {
        unique(assigned, "as", statement);
        output = text.substring(3).trim();
      } else throw error("Unsupported statement for " + type + ": " + text, statement);
    }
    return new Node(
        id,
        type,
        label,
        position,
        expression,
        output,
        ruleId,
        version,
        type.equals("REFERENCE") ? bindings : null,
        type.equals("SWITCH") ? cases : null,
        type.equals("TRANSFORM") && !fields.isEmpty() ? fields : null);
  }

  private void checkExpression(String expression, Statement statement) {
    try {
      Expressions.compile(expression);
    } catch (ArcException e) {
      throw error(e.getMessage(), statement);
    }
  }

  private void unique(Set<String> keys, String key, Statement statement) {
    if (!keys.add(key)) throw error("Duplicate statement: " + key, statement);
  }

  private record Assignment(String variable, String expression) {}

  private Assignment assignment(String text, Statement statement) {
    var match = ASSIGNMENT.matcher(text);
    if (!match.matches()) throw error("Expected variable = expression", statement);
    return new Assignment(match.group(1), match.group(2).trim());
  }

  private <T> T read(String text, Class<T> type, Statement statement) {
    try {
      return json.readerFor(type)
          .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .readValue(text);
    } catch (JsonProcessingException failure) {
      throw error("Invalid JSON literal or source binding", statement);
    }
  }

  private String unquote(String text, Statement statement) {
    return text.startsWith("\"") ? read(text, String.class, statement) : text;
  }

  private static SyntaxException error(String message, Statement statement) {
    return new SyntaxException(message, statement.line(), statement.column());
  }
}
