package dev.arc.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.api.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.regex.*;
import org.springframework.stereotype.Component;

/** Declarative graph syntax: parsed as data, never executed as host-language code. */
@Component
public class ArcScript {
  private final ObjectMapper json;
  private final Validator validator;
  private static final String ID = "(\"(?:[^\"\\\\]|\\\\.)*\"|[A-Za-z_][A-Za-z_0-9-]*)";
  private static final Pattern HEADER =
      Pattern.compile(
          "node\\s+"
              + ID
              + "\\s+(INPUT|FORMULA|CONDITION|REFERENCE|OUTPUT)\\s+(\"(?:[^\"\\\\]|\\\\.)*\")(?:\\s+at\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*\\))?",
          Pattern.CASE_INSENSITIVE);
  private static final Pattern INPUT =
      Pattern.compile(
          "([A-Za-z_][A-Za-z_0-9]*)\\s*:\\s*(NUMBER|STRING|BOOLEAN|ARRAY|OBJECT)\\s+(required|optional)(?:\\s+default\\s+(.+))?",
          Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  private static final Pattern EDGE =
      Pattern.compile(
          "(next|true|false)\\s*->\\s*" + ID + "(?:\\s+edge\\s+" + ID + ")?",
          Pattern.CASE_INSENSITIVE);

  private record Statement(String text, int line, int column) {}

  public record Diagnostic(String message, int line, int column) {}

  public record Build(Definition definition, String source, List<Diagnostic> diagnostics) {}

  public ArcScript(ObjectMapper json, Validator validator) {
    this.json = json;
    this.validator = validator;
  }

  public Build build(String source) {
    try {
      Definition definition = parse(source);
      validator.shape(definition);
      return new Build(definition, render(definition), List.of());
    } catch (ScriptError e) {
      return new Build(null, source, List.of(new Diagnostic(e.getMessage(), e.line, e.column)));
    } catch (ArcException e) {
      return new Build(null, source, List.of(new Diagnostic(e.getMessage(), 1, 1)));
    }
  }

  public Definition parse(String source) {
    if (source == null || source.length() > 100_000)
      throw new ScriptError("Source must be at most 100,000 characters", 1, 1);
    var scanner = new Scanner(source);
    var inputs = new ArrayList<Input>();
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    Map<String, SourceBinding> sources = new HashMap<>();
    boolean inputBlock = false;
    int schema = 1;
    while (scanner.more()) {
      Statement header = scanner.readHeader();
      String h = header.text();
      if (h.equalsIgnoreCase("schema 1")) {
        scanner.expect(';');
        continue;
      }
      if (h.equalsIgnoreCase("inputs")) {
        if (inputBlock) throw error("Only one inputs block is allowed", header);
        inputBlock = true;
        scanner.expect('{');
        for (Statement st : scanner.body()) {
          if (st.text().startsWith("source ")) {
            Matcher m =
                Pattern.compile("source\\s+(\\w+)\\s*=\\s*(.+)", Pattern.DOTALL).matcher(st.text());
            if (!m.matches()) throw error("Use: source parameter = { JSON source binding };", st);
            if (sources.putIfAbsent(m.group(1), read(m.group(2), SourceBinding.class, st)) != null)
              throw error("Duplicate input source", st);
          } else {
            Matcher m = INPUT.matcher(st.text());
            if (!m.matches())
              throw error(
                  "Use: parameter: NUMBER|STRING|BOOLEAN|ARRAY|OBJECT required|optional [default"
                      + " JSON];",
                  st);
            inputs.add(
                new Input(
                    m.group(1),
                    m.group(2).toUpperCase(Locale.ROOT),
                    m.group(3).equalsIgnoreCase("required"),
                    m.group(4) == null ? null : read(m.group(4), Object.class, st)));
          }
        }
        continue;
      }
      Matcher m = HEADER.matcher(h);
      if (!m.matches())
        throw error(
            "Expected inputs { ... } or node id TYPE \"Label\" [at (x, y)] { ... }", header);
      scanner.expect('{');
      String id = unquote(m.group(1), header),
          type = m.group(2).toUpperCase(Locale.ROOT),
          label = unquote(m.group(3), header);
      Position position =
          m.group(4) == null
              ? new Position((nodes.size() % 3) * 300, (nodes.size() / 3) * 170)
              : new Position(Double.parseDouble(m.group(4)), Double.parseDouble(m.group(5)));
      String expression = null, output = null, ruleId = null;
      Integer version = null;
      var bindings = new LinkedHashMap<String, String>();
      var assigned = new HashSet<String>();
      for (Statement st : scanner.body()) {
        String text = st.text();
        Matcher edge = EDGE.matcher(text);
        if (edge.matches()) {
          String handle = edge.group(1).toLowerCase(Locale.ROOT),
              target = unquote(edge.group(2), st);
          unique(assigned, handle, st);
          edges.add(
              new Edge(
                  edge.group(3) == null
                      ? id + "-" + handle + "-" + target
                      : unquote(edge.group(3), st),
                  id,
                  target,
                  handle));
          continue;
        }
        if (text.startsWith("let ") && type.equals("FORMULA")) {
          var assignment = assignment(text.substring(4), st);
          unique(assigned, "expression", st);
          output = assignment[0];
          expression = assignment[1];
          checkExpression(expression, st);
        } else if (text.startsWith("when ") && type.equals("CONDITION")) {
          unique(assigned, "expression", st);
          expression = text.substring(5).trim();
          checkExpression(expression, st);
        } else if (text.startsWith("return ") && type.equals("OUTPUT")) {
          unique(assigned, "expression", st);
          expression = text.substring(7).trim();
          checkExpression(expression, st);
        } else if (text.startsWith("use ") && type.equals("REFERENCE")) {
          var use = Pattern.compile("use\\s+" + ID + "\\s+version\\s+([1-9]\\d*)").matcher(text);
          if (!use.matches()) throw error("Use: use \"rule-id\" version 1;", st);
          unique(assigned, "use", st);
          ruleId = unquote(use.group(1), st);
          try {
            version = Integer.parseInt(use.group(2));
          } catch (NumberFormatException e) {
            throw error("Version is too large", st);
          }
        } else if (text.startsWith("bind ") && type.equals("REFERENCE")) {
          var assignment = assignment(text.substring(5), st);
          unique(assigned, "bind:" + assignment[0], st);
          checkExpression(assignment[1], st);
          bindings.put(assignment[0], assignment[1]);
        } else if (text.startsWith("as ") && type.equals("REFERENCE")) {
          unique(assigned, "as", st);
          output = text.substring(3).trim();
        } else throw error("Unsupported statement for " + type + ": " + text, st);
      }
      nodes.add(
          new Node(
              id,
              type,
              label,
              position,
              expression,
              output,
              ruleId,
              version,
              type.equals("REFERENCE") ? bindings : null));
    }
    for (String name : sources.keySet())
      if (inputs.stream().noneMatch(p -> p.name().equals(name)))
        throw new ScriptError("Source refers to unknown input: " + name, 1, 1);
    return new Definition(
        schema,
        inputs.stream()
            .map(
                p ->
                    new Input(
                        p.name(), p.type(), p.required(), p.defaultValue(), sources.get(p.name())))
            .toList(),
        nodes,
        edges,
        scanner.notes);
  }

  public String render(Definition d) {
    validator.shape(d);
    StringBuilder out = new StringBuilder("schema 1;\n\n");
    if (d.notes() != null)
      for (String note : d.notes())
        for (String line : note.split("\\R", -1)) out.append("// ").append(line).append('\n');
    out.append("inputs {\n");
    for (Input p : d.inputs()) {
      out.append("  ")
          .append(p.name())
          .append(": ")
          .append(p.type())
          .append(p.required() ? " required" : " optional");
      if (p.defaultValue() != null) out.append(" default ").append(write(p.defaultValue()));
      out.append(";\n");
      if (p.source() != null)
        out.append("  source ")
            .append(p.name())
            .append(" = ")
            .append(write(p.source()))
            .append(";\n");
    }
    out.append("}\n");
    for (Node n : d.nodes()) {
      out.append("\nnode ")
          .append(write(n.id()))
          .append(' ')
          .append(n.type())
          .append(' ')
          .append(write(n.label()));
      if (n.position() != null)
        out.append(" at (")
            .append(n.position().x())
            .append(", ")
            .append(n.position().y())
            .append(')');
      out.append(" {\n");
      switch (n.type()) {
        case "FORMULA" ->
            out.append("  let ")
                .append(n.output() == null ? "result" : n.output())
                .append(" = ")
                .append(n.expression() == null ? "0" : n.expression())
                .append(";\n");
        case "CONDITION" ->
            out.append("  when ")
                .append(n.expression() == null ? "true" : n.expression())
                .append(";\n");
        case "OUTPUT" ->
            out.append("  return ")
                .append(n.expression() == null ? "null" : n.expression())
                .append(";\n");
        case "REFERENCE" -> {
          if (n.ruleId() != null && n.version() != null)
            out.append("  use ")
                .append(write(n.ruleId()))
                .append(" version ")
                .append(n.version())
                .append(";\n");
          if (n.bindings() != null)
            new TreeMap<>(n.bindings())
                .forEach(
                    (key, value) ->
                        out.append("  bind ")
                            .append(key)
                            .append(" = ")
                            .append(value)
                            .append(";\n"));
          out.append("  as ").append(n.output() == null ? "result" : n.output()).append(";\n");
        }
        default -> {}
      }
      for (Edge e : d.edges())
        if (e.source().equals(n.id()))
          out.append("  ")
              .append(e.sourceHandle())
              .append(" -> ")
              .append(write(e.target()))
              .append(" edge ")
              .append(write(e.id()))
              .append(";\n");
      out.append("}\n");
    }
    return out.toString();
  }

  private void checkExpression(String expression, Statement st) {
    try {
      Expressions.compile(expression);
    } catch (ArcException e) {
      throw error(e.getMessage(), st);
    }
  }

  private void unique(Set<String> keys, String key, Statement st) {
    if (!keys.add(key)) throw error("Duplicate statement: " + key, st);
  }

  private String[] assignment(String s, Statement st) {
    var m = Pattern.compile("([A-Za-z_][A-Za-z_0-9]*)\\s*=\\s*(.+)", Pattern.DOTALL).matcher(s);
    if (!m.matches()) throw error("Expected variable = expression", st);
    return new String[] {m.group(1), m.group(2).trim()};
  }

  private String write(Object o) {
    try {
      return json.writeValueAsString(o);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private <T> T read(String s, Class<T> type, Statement st) {
    try {
      return json.readerFor(type)
          .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .readValue(s);
    } catch (Exception e) {
      throw error("Invalid JSON literal or source binding", st);
    }
  }

  private String unquote(String s, Statement st) {
    return s.startsWith("\"") ? read(s, String.class, st) : s;
  }

  private static ScriptError error(String message, Statement s) {
    return new ScriptError(message, s.line(), s.column());
  }

  private static final class ScriptError extends RuntimeException {
    final int line, column;

    ScriptError(String message, int line, int column) {
      super(message);
      this.line = line;
      this.column = column;
    }
  }

  private static final class Scanner {
    final String source;
    int index = 0, line = 1, column = 1;
    final List<String> notes = new ArrayList<>();

    Scanner(String source) {
      this.source = source;
    }

    void advance() {
      if (source.charAt(index++) == '\n') {
        line++;
        column = 1;
      } else column++;
    }

    void whitespace() {
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
        throw new ScriptError("Expected '" + c + "'", line, column);
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

    Statement scan(boolean header) {
      whitespace();
      int start = index, startLine = line, startColumn = column, nesting = 0;
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
          throw new ScriptError("Statement must end with ';'", line, column);
        if (c == '{' || c == '[' || c == '(') nesting++;
        if (c == '}' || c == ']' || c == ')') nesting--;
        advance();
      }
      if (quote != 0 || index >= source.length())
        throw new ScriptError("Unfinished statement or quoted string", startLine, startColumn);
      return new Statement(source.substring(start, index).trim(), startLine, startColumn);
    }
  }
}
