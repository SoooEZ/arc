package dev.arc.engine.script;

import static dev.arc.engine.script.ArcScriptSyntax.ID;
import static dev.arc.engine.script.ArcScriptSyntax.QUOTED;
import static dev.arc.engine.script.ArcScriptSyntax.error;
import static dev.arc.engine.script.ArcScriptSyntax.identifier;
import static java.nio.charset.StandardCharsets.UTF_8;

import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.script.ArcScriptScanner.Statement;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.NodeKind.Property;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * One node's grammar session: declarations, owned expressions, pins and outgoing connections.
 * Unfinished drafts omit a statement to leave its value unset, or leave the value itself empty:
 * {@code return;}, {@code select;}, {@code let total;}, {@code let = amount;} or {@code use
 * "rule-id";}.
 */
final class ArcScriptNodeParser {
  /** Every node kind's name as a regular-expression alternative; headers may use any case. */
  private static final String KINDS =
      Arrays.stream(NodeKind.values()).map(NodeKind::name).collect(Collectors.joining("|"));

  private static final Pattern HEADER =
      Pattern.compile(
          "node\\s+"
              + ID
              + "\\s+("
              + KINDS
              + ")\\s+("
              + QUOTED
              + ")(?:\\s+at\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*\\))?",
          Pattern.CASE_INSENSITIVE);

  /** A connection {@code handle -> target [edge id]}; fixed handle names may use any case. */
  private static final Pattern EDGE =
      Pattern.compile(
          "("
              + String.join("|", Handles.FIXED)
              + "|"
              + Handles.CASE_PREFIX
              + Identifiers.CASE_ID_SYNTAX
              + ")\\s*->\\s*"
              + ID
              + "(?:\\s+edge\\s+"
              + ID
              + ")?",
          Pattern.CASE_INSENSITIVE);

  private static final Pattern CASE =
      Pattern.compile(
          "case\\s+" + ID + "\\s+" + ID + "\\s+(when|equals)(?:\\s+(.*))?", Pattern.DOTALL);
  private static final Pattern FIELD =
      Pattern.compile("field\\s+" + ID + "\\s*=\\s*(.*)", Pattern.DOTALL);
  private static final Pattern REFERENCE =
      Pattern.compile("use\\s+" + ID + "(?:\\s+version\\s+([1-9]\\d*))?");

  /** What ends a statement's first word. */
  private static final Pattern WHITESPACE = Pattern.compile("\\s");

  /** Node IDs that cannot be confused with the hyphens joining a readable connection ID. */
  private static final Pattern PLAIN_NODE_ID = Pattern.compile("[A-Za-z0-9_]+");

  private static final int DIGEST_CHARACTERS = 16;

  private final ArcScriptSyntax syntax;
  private final Statement header;
  private final String id;
  private final NodeKind kind;
  private final Set<String> keywords;
  private final String label;
  private final Position position;
  private final Map<String, String> bindings = new LinkedHashMap<>();
  private final List<BranchCase> cases = new ArrayList<>();
  private final List<Field> fields = new ArrayList<>();
  private final Set<String> assigned = new HashSet<>();
  private String expression;
  private String selector;
  private Boolean valueCases;
  private Statement firstCase;
  private String output;
  private String outputName;
  private String ruleId;
  private Integer version;

  /**
   * {@code fallback} is the position of a header without {@code at (x, y)}; null keeps it unset.
   */
  ArcScriptNodeParser(
      ArcScriptSyntax syntax, Statement header, ArcScriptScanner scanner, Position fallback) {
    this.syntax = syntax;
    this.header = header;
    Matcher match = HEADER.matcher(header.text());
    if (!match.matches())
      throw error("Expected inputs { ... } or node id TYPE \"Label\" [at (x, y)] { ... }", header);
    scanner.expect('{');
    id = syntax.unquote(match.group(1), header);
    kind = NodeKind.valueOf(match.group(2).toUpperCase(Locale.ROOT));
    keywords = declarationKeywords(kind);
    label = syntax.unquote(match.group(3), header);
    position =
        match.group(4) == null
            ? fallback
            : new Position(Double.parseDouble(match.group(4)), Double.parseDouble(match.group(5)));
  }

  Node parse(ArcScriptScanner scanner, List<Edge> edges, ScriptLocations locations) {
    for (Statement statement : scanner.body()) {
      Matcher edge = EDGE.matcher(statement.text());
      if (edge.matches()) edges.add(parseEdge(edge, statement, locations));
      else parseDeclaration(statement, locations);
    }
    if (valueCases != null && valueCases != (selector != null))
      throw error(
          valueCases
              ? "Value cases require select expression;"
              : "Use equals for cases when select is configured",
          firstCase);
    var node =
        new Node(
            id,
            kind.name(),
            label,
            position,
            expression,
            output,
            ruleId,
            version,
            kind.uses(Property.BINDINGS) ? bindings : null,
            kind.uses(Property.CASES) ? cases : null,
            kind.uses(Property.FIELDS) && !fields.isEmpty() ? fields : null,
            selector,
            outputName);
    locations.declared(node, header);
    return node;
  }

  private Edge parseEdge(Matcher match, Statement statement, ScriptLocations locations) {
    String handle = handle(match.group(1));
    String target = syntax.unquote(match.group(2), statement);
    String edgeId;
    if (match.group(3) == null) {
      // Two such statements would generate the same ID. Explicit IDs are checked by draft shape,
      // and a duplicate connection stays an executable-validation problem, as for a JSON draft:
      // the renderer writes every stored edge with its ID, so a saved draft must build back.
      unique(handle + ":" + target, statement);
      edgeId = connectionId(id, handle, target);
    } else edgeId = syntax.unquote(match.group(3), statement);
    var edge = new Edge(edgeId, id, target, handle);
    locations.declared(edge, statement);
    return edge;
  }

  /** A handle as the graph stores it: fixed names in lower case; a case ID as it was written. */
  private static String handle(String written) {
    String lower = written.toLowerCase(Locale.ROOT);
    if (!lower.startsWith(Handles.CASE_PREFIX)) return lower;
    return Handles.forCase(written.substring(Handles.CASE_PREFIX.length()));
  }

  /**
   * The ID of a connection written without {@code edge "id"}. It is {@code source-handle-target}
   * when that fits the edge-ID limit and can mean only one connection. Hyphens in node IDs make
   * that spelling ambiguous ({@code a} to {@code b-next-c} versus {@code a-next-b} to {@code c}),
   * so such connections, and long ones, keep a bounded prefix and add a digest of the exact
   * connection after {@code ~}, which readable IDs never contain.
   */
  static String connectionId(String source, String handle, String target) {
    String readable = source + "-" + handle + "-" + target;
    if (PLAIN_NODE_ID.matcher(source).matches()
        && PLAIN_NODE_ID.matcher(target).matches()
        && readable.length() <= Limits.MAX_EDGE_ID_CHARACTERS) return readable;
    int prefixLength = Limits.MAX_EDGE_ID_CHARACTERS - DIGEST_CHARACTERS - 1;
    return prefix(readable, prefixLength) + "~" + digest(source, handle, target);
  }

  private static String prefix(String text, int maximum) {
    if (text.length() <= maximum) return text;
    int end = Character.isHighSurrogate(text.charAt(maximum - 1)) ? maximum - 1 : maximum;
    return text.substring(0, end);
  }

  /** Length-prefixed parts, so different connections never hash the same text. */
  private static String digest(String... parts) {
    try {
      var sha = MessageDigest.getInstance("SHA-256");
      for (String part : parts) {
        sha.update((part.length() + ":").getBytes(UTF_8));
        sha.update(part.getBytes(UTF_8));
      }
      return HexFormat.of().formatHex(sha.digest(), 0, DIGEST_CHARACTERS / 2);
    } catch (NoSuchAlgorithmException missing) {
      throw new IllegalStateException("Every Java platform provides SHA-256", missing);
    }
  }

  private void parseDeclaration(Statement statement, ScriptLocations locations) {
    String text = statement.text();
    String keyword = WHITESPACE.split(text, 2)[0];
    if (!keywords.contains(keyword))
      throw error("Unsupported statement for " + kind + ": " + text, statement);
    String value = text.substring(keyword.length()).trim();
    switch (keyword) {
      case "let" -> parseLet(value, statement);
      case "case" -> parseCase(statement, locations);
      case "field" -> parseField(statement, locations);
      case "use" -> parseReference(statement);
      case "bind" -> parseBinding(value, statement);
      case "select" -> {
        unique("selector", statement);
        selector = optionalExpression(value, statement);
      }
      case "as" -> {
        unique("as", statement);
        String name = identifier(value, statement);
        switch (aliasTarget(kind)) {
          case OUTPUT_NAME -> outputName = name;
          case OUTPUT -> output = name;
          default -> throw new IllegalStateException("as cannot declare " + aliasTarget(kind));
        }
      }
      case "when", "return" -> {
        unique("expression", statement);
        expression = optionalExpression(value, statement);
      }
      default -> throw new IllegalStateException("Accepted but unparsed statement: " + keyword);
    }
  }

  /**
   * The declaration statements each node kind owns; connections are parsed separately. A new kind
   * does not compile until it decides which statements it accepts.
   */
  private static Set<String> declarationKeywords(NodeKind kind) {
    return switch (kind) {
      case INPUT -> Set.of();
      case FORMULA -> Set.of("let");
      case CONDITION -> Set.of("when");
      case SWITCH -> Set.of("select", "case");
      case TRANSFORM -> Set.of("let", "field", "as");
      case REFERENCE -> Set.of("use", "bind", "as");
      case OUTPUT -> Set.of("return", "as");
    };
  }

  /**
   * The property that {@code as name;} declares: an Output's field name, or the result variable of
   * a Transform or Reference. The keyword table above rejects {@code as} for the other kinds first.
   */
  private static Property aliasTarget(NodeKind kind) {
    return switch (kind) {
      case OUTPUT -> Property.OUTPUT_NAME;
      case TRANSFORM, REFERENCE -> Property.OUTPUT;
      case INPUT, FORMULA, CONDITION, SWITCH ->
          throw new IllegalStateException("as is not declared for " + kind);
    };
  }

  /** {@code let [name] [= [expression]]}: an unfinished draft may lack either part. */
  private void parseLet(String declaration, Statement statement) {
    unique("expression", statement);
    unique("as", statement);
    int equals = declaration.indexOf('=');
    String name = (equals < 0 ? declaration : declaration.substring(0, equals)).trim();
    output = name.isEmpty() ? null : identifier(name, statement);
    if (equals >= 0)
      expression = optionalExpression(declaration.substring(equals + 1).trim(), statement);
  }

  private void parseCase(Statement statement, ScriptLocations locations) {
    Matcher match = CASE.matcher(statement.text());
    if (!match.matches())
      throw error(
          "Use: case id \"Label\" when predicate; or case id \"Label\" equals value;", statement);
    String caseId = syntax.unquote(match.group(1), statement);
    unique(Handles.forCase(caseId), statement);
    boolean valueCase = match.group(3).equals("equals");
    if (valueCases != null && valueCases != valueCase)
      throw error("Cannot mix when and equals cases", statement);
    valueCases = valueCase;
    if (firstCase == null) firstCase = statement;
    String value = match.group(4) == null ? "" : match.group(4).trim();
    var option =
        new BranchCase(
            caseId,
            syntax.unquote(match.group(2), statement),
            optionalExpression(value, statement));
    locations.declared(option, statement);
    cases.add(option);
  }

  private void parseField(Statement statement, ScriptLocations locations) {
    Matcher match = FIELD.matcher(statement.text());
    if (!match.matches()) throw error("Use: field \"name\" = expression;", statement);
    String name = syntax.unquote(match.group(1), statement);
    unique("field:" + name, statement);
    var field = new Field(name, optionalExpression(match.group(2).trim(), statement));
    locations.declared(field, statement);
    fields.add(field);
  }

  /** {@code use "rule-id" [version n]}: a draft may choose the rule before its version. */
  private void parseReference(Statement statement) {
    Matcher match = REFERENCE.matcher(statement.text());
    if (!match.matches()) throw error("Use: use \"rule-id\" version 1;", statement);
    unique("use", statement);
    ruleId = syntax.unquote(match.group(1), statement);
    if (match.group(2) == null) return;
    try {
      version = Integer.parseInt(match.group(2));
    } catch (NumberFormatException failure) {
      throw error("Version is too large", statement);
    }
  }

  private void parseBinding(String declaration, Statement statement) {
    int equals = declaration.indexOf('=');
    if (equals < 0) throw error("Expected variable = expression", statement);
    String name = identifier(declaration.substring(0, equals).trim(), statement);
    unique("bind:" + name, statement);
    bindings.put(name, optionalExpression(declaration.substring(equals + 1).trim(), statement));
  }

  /** An empty value stays empty, as in an unfinished draft; any other value must parse. */
  private String optionalExpression(String source, Statement statement) {
    if (source.isEmpty()) return source;
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
}
