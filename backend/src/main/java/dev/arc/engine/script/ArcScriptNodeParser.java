package dev.arc.engine.script;

import static dev.arc.engine.script.ArcScriptSyntax.ID;
import static dev.arc.engine.script.ArcScriptSyntax.error;

import dev.arc.engine.expression.Expressions;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.*;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** One node's grammar session: declarations, owned expressions, pins and outgoing connections. */
final class ArcScriptNodeParser {
  private static final Pattern HEADER =
      Pattern.compile(
          "node\\s+"
              + ID
              + "\\s+(INPUT|FORMULA|CONDITION|SWITCH|TRANSFORM|REFERENCE|OUTPUT)\\s+(\"(?:[^\"\\\\]|\\\\.)*\")(?:\\s+at\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*\\))?",
          Pattern.CASE_INSENSITIVE);
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
  private static final Pattern ASSIGNMENT =
      Pattern.compile("([A-Za-z_][A-Za-z_0-9]*)\\s*=\\s*(.+)", Pattern.DOTALL);
  private static final Pattern REFERENCE =
      Pattern.compile("use\\s+" + ID + "\\s+version\\s+([1-9]\\d*)");

  private final ArcScriptSyntax syntax;
  private final String id;
  private final String type;
  private final String label;
  private final Position position;
  private final Map<String, String> bindings = new LinkedHashMap<>();
  private final List<BranchCase> cases = new ArrayList<>();
  private final List<Field> fields = new ArrayList<>();
  private final Set<String> assigned = new HashSet<>();
  private String expression;
  private String output;
  private String ruleId;
  private Integer version;

  ArcScriptNodeParser(
      ArcScriptSyntax syntax, Statement header, ArcScriptScanner scanner, int nodeIndex) {
    this.syntax = syntax;
    Matcher match = HEADER.matcher(header.text());
    if (!match.matches())
      throw error("Expected inputs { ... } or node id TYPE \"Label\" [at (x, y)] { ... }", header);
    scanner.expect('{');
    id = syntax.unquote(match.group(1), header);
    type = match.group(2).toUpperCase(Locale.ROOT);
    label = syntax.unquote(match.group(3), header);
    position =
        match.group(4) == null
            ? new Position((nodeIndex % 3) * 300, (nodeIndex / 3) * 170)
            : new Position(Double.parseDouble(match.group(4)), Double.parseDouble(match.group(5)));
  }

  Node parse(ArcScriptScanner scanner, List<Edge> edges) {
    for (Statement statement : scanner.body()) {
      Matcher edge = EDGE.matcher(statement.text());
      if (edge.matches()) edges.add(parseEdge(edge, statement));
      else parseDeclaration(statement);
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

  private Edge parseEdge(Matcher match, Statement statement) {
    String rawHandle = match.group(1);
    String handle =
        rawHandle.toLowerCase(Locale.ROOT).startsWith("case:")
            ? "case:" + rawHandle.substring(5)
            : rawHandle.toLowerCase(Locale.ROOT);
    String target = syntax.unquote(match.group(2), statement);
    unique(handle + ":" + target, statement);
    String edgeId =
        match.group(3) == null
            ? id + "-" + handle + "-" + target
            : syntax.unquote(match.group(3), statement);
    return new Edge(edgeId, id, target, handle);
  }

  private void parseDeclaration(Statement statement) {
    String text = statement.text();
    if (text.startsWith("let ") && (type.equals("FORMULA") || type.equals("TRANSFORM"))) {
      Assignment assignment = assignment(text.substring(4), statement);
      unique("expression", statement);
      unique("as", statement);
      output = assignment.variable();
      expression = checkedExpression(assignment.expression(), statement);
    } else if (text.startsWith("case ") && type.equals("SWITCH")) {
      parseCase(statement);
    } else if (text.startsWith("field ") && type.equals("TRANSFORM")) {
      parseField(statement);
    } else if (text.startsWith("when ") && type.equals("CONDITION")) {
      unique("expression", statement);
      expression = checkedExpression(text.substring(5).trim(), statement);
    } else if (text.startsWith("return ") && type.equals("OUTPUT")) {
      unique("expression", statement);
      expression = checkedExpression(text.substring(7).trim(), statement);
    } else if (text.startsWith("use ") && type.equals("REFERENCE")) {
      parseReference(statement);
    } else if (text.startsWith("bind ") && type.equals("REFERENCE")) {
      parseBinding(statement);
    } else if (text.startsWith("as ") && (type.equals("REFERENCE") || type.equals("TRANSFORM"))) {
      unique("as", statement);
      output = text.substring(3).trim();
    } else {
      throw error("Unsupported statement for " + type + ": " + text, statement);
    }
  }

  private void parseCase(Statement statement) {
    Matcher match = CASE.matcher(statement.text());
    if (!match.matches()) throw error("Use: case id \"Label\" when expression;", statement);
    String caseId = syntax.unquote(match.group(1), statement);
    unique("case:" + caseId, statement);
    String predicate = checkedExpression(match.group(3), statement);
    cases.add(new BranchCase(caseId, syntax.unquote(match.group(2), statement), predicate.trim()));
  }

  private void parseField(Statement statement) {
    Matcher match = FIELD.matcher(statement.text());
    if (!match.matches()) throw error("Use: field \"name\" = expression;", statement);
    String name = syntax.unquote(match.group(1), statement);
    unique("field:" + name, statement);
    String value = checkedExpression(match.group(2), statement);
    fields.add(new Field(name, value.trim()));
  }

  private void parseReference(Statement statement) {
    Matcher match = REFERENCE.matcher(statement.text());
    if (!match.matches()) throw error("Use: use \"rule-id\" version 1;", statement);
    unique("use", statement);
    ruleId = syntax.unquote(match.group(1), statement);
    try {
      version = Integer.parseInt(match.group(2));
    } catch (NumberFormatException failure) {
      throw error("Version is too large", statement);
    }
  }

  private void parseBinding(Statement statement) {
    Assignment assignment = assignment(statement.text().substring(5), statement);
    unique("bind:" + assignment.variable(), statement);
    bindings.put(assignment.variable(), checkedExpression(assignment.expression(), statement));
  }

  private String checkedExpression(String source, Statement statement) {
    try {
      Expressions.compile(source);
      return source;
    } catch (ArcException failure) {
      throw error(failure.getMessage(), statement);
    }
  }

  private void unique(String key, Statement statement) {
    if (!assigned.add(key)) throw error("Duplicate statement: " + key, statement);
  }

  private record Assignment(String variable, String expression) {}

  private Assignment assignment(String text, Statement statement) {
    Matcher match = ASSIGNMENT.matcher(text);
    if (!match.matches()) throw error("Expected variable = expression", statement);
    return new Assignment(match.group(1), match.group(2).trim());
  }
}
