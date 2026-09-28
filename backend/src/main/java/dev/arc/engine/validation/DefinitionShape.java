package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.engine.Limits;
import dev.arc.engine.validation.ShapeViolation.*;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.NodeKind.Property;
import java.util.*;
import java.util.function.Function;
import java.util.regex.Pattern;

/** Stored draft shape and size limits, independent of whether the graph can execute. */
final class DefinitionShape {
  private static final Pattern NODE_ID =
      Pattern.compile("[A-Za-z0-9_-]{1," + Limits.MAX_NODE_ID_CHARACTERS + "}");
  private static final Pattern CASE_ID = Pattern.compile(Identifiers.CASE_ID_SYNTAX);
  private static final Pattern CASE_HANDLE =
      Pattern.compile(Handles.CASE_PREFIX + Identifiers.CASE_ID_SYNTAX);
  private static final String EXPRESSION_LIMIT =
      Limits.format(Limits.MAX_EXPRESSION_CHARACTERS) + " characters";
  private static final Document DOCUMENT = new Document();

  /**
   * Whether content is checked besides structure. The scope plan reads only structure (node IDs and
   * kinds, Switch cases, connections and input names), so {@code /variables} checks that alone: a
   * blank label, an oversized expression, an unused property or an invalid default elsewhere in the
   * draft cannot change any node's scope, and used to blank every inspector instead.
   */
  private final boolean contentChecks;

  DefinitionShape() {
    this(true);
  }

  private DefinitionShape(boolean contentChecks) {
    this.contentChecks = contentChecks;
  }

  /** The checks that keep a scope plan well defined, in the same order; content problems pass. */
  static DefinitionShape structureOnly() {
    return new DefinitionShape(false);
  }

  /** Throws the first violation, located at the node that owns it. */
  void validate(Definition definition) {
    var violation = firstViolation(definition);
    if (violation.isPresent()) throw located(violation.get(), definition);
  }

  Optional<ShapeViolation> firstViolation(Definition definition) {
    try {
      checkDocument(definition);
      Set<String> nodeIds = checkNodes(definition.nodes());
      checkEdges(definition.edges(), nodeIds);
      InputValidation.checkSchema(definition.inputs(), contentChecks);
      return Optional.empty();
    } catch (Violated stop) {
      return Optional.of(stop.violation);
    }
  }

  /**
   * Node, case and field problems appear on their node. A connection belongs to the node it leaves,
   * or to the node it enters when its source is missing. Document and input problems have no node.
   */
  static ArcException located(ShapeViolation violation, Definition definition) {
    var error = ArcException.invalid(violation.message());
    Node owner = owner(violation.element(), definition);
    return owner == null ? error : error.atNode(null, null, owner.id(), owner.label());
  }

  private static Node owner(Element element, Definition definition) {
    return switch (element) {
      case NodeDeclaration declaration -> declaration.node();
      case SwitchCase switchCase -> switchCase.node();
      case TransformField field -> field.node();
      case Connection connection -> connectedNode(connection.edge(), definition);
      case Document document -> null;
      case Note note -> null;
      case InputDeclaration declaration -> null;
      case InputSource source -> null;
    };
  }

  private static Node connectedNode(Edge edge, Definition definition) {
    if (edge == null) return null;
    Node target = null;
    for (Node node : definition.nodes()) {
      if (node == null) continue;
      if (Objects.equals(node.id(), edge.source())) return node;
      if (target == null && Objects.equals(node.id(), edge.target())) target = node;
    }
    return target;
  }

  private void checkDocument(Definition definition) {
    require(definition != null, DOCUMENT, "Definition is required");
    require(definition.schemaVersion() == 1, DOCUMENT, "Only schemaVersion 1 is supported");
    String inputLimit = "Provide at most " + Limits.MAX_INPUTS + " inputs";
    require(definition.inputs() != null, DOCUMENT, inputLimit);
    requireAtMost(definition.inputs(), Limits.MAX_INPUTS, InputDeclaration::new, inputLimit);
    String nodeLimit = "Provide 1 to " + Limits.MAX_NODES + " nodes";
    require(definition.nodes() != null && !definition.nodes().isEmpty(), DOCUMENT, nodeLimit);
    requireAtMost(definition.nodes(), Limits.MAX_NODES, NodeDeclaration::new, nodeLimit);
    String edgeLimit = "Provide at most " + Limits.MAX_EDGES + " edges";
    require(definition.edges() != null, DOCUMENT, edgeLimit);
    requireAtMost(definition.edges(), Limits.MAX_EDGES, Connection::new, edgeLimit);
    if (contentChecks) checkNotes(definition.notes());
  }

  private void checkNotes(List<String> notes) {
    if (notes == null) return;
    String message = "Too many or oversized comments";
    require(notes.size() <= Limits.MAX_NOTES, new Note(Limits.MAX_NOTES), message);
    for (int index = 0; index < notes.size(); index++) {
      String note = notes.get(index);
      require(
          note != null && note.length() <= Limits.MAX_NOTE_CHARACTERS, new Note(index), message);
    }
  }

  private Set<String> checkNodes(List<Node> nodes) {
    Set<String> ids = new HashSet<>();
    for (Node node : nodes) checkNode(node, ids);
    return ids;
  }

  private void checkNode(Node node, Set<String> ids) {
    var declaration = new NodeDeclaration(node);
    require(
        node != null && node.id() != null && NODE_ID.matcher(node.id()).matches(),
        declaration,
        "Every node needs a valid ID");
    if (contentChecks)
      require(
          node.position() == null
              || Double.isFinite(node.position().x())
                  && Double.isFinite(node.position().y())
                  && Math.abs(node.position().x()) <= Limits.MAX_CANVAS_COORDINATE
                  && Math.abs(node.position().y()) <= Limits.MAX_CANVAS_COORDINATE,
          declaration,
          "Node position must be finite and within canvas bounds");
    require(ids.add(node.id()), declaration, "Duplicate node ID: " + node.id());
    require(
        NodeKind.parse(node.type()).isPresent(), declaration, "Unknown node type: " + node.type());
    NodeKind kind = node.kind();
    if (contentChecks) checkContent(node, kind);
    checkCases(node, kind);
    if (contentChecks) {
      checkFields(node);
      checkBindings(node);
      checkPin(node);
    }
  }

  /** What a node says, beyond how it is connected: its label, properties and expression sizes. */
  private void checkContent(Node node, NodeKind kind) {
    var declaration = new NodeDeclaration(node);
    require(
        node.label() != null
            && !node.label().isBlank()
            && node.label().length() <= Limits.MAX_LABEL_CHARACTERS,
        declaration,
        "Every node needs a label of 1 to " + Limits.MAX_LABEL_CHARACTERS + " characters");
    // A property its kind does not use would be ignored silently, so no graph may keep one.
    for (Property property : Property.values())
      require(kind.uses(property) || !node.sets(property), declaration, belongsTo(property));
    require(
        node.expression() == null || node.expression().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
        declaration,
        "Expression exceeds " + EXPRESSION_LIMIT);
    require(
        node.output() == null || node.output().isEmpty() || Identifiers.isValid(node.output()),
        declaration,
        node.label() + ": provide a valid result variable");
    require(
        node.outputName() == null
            || node.outputName().isEmpty()
            || Identifiers.isValid(node.outputName()),
        declaration,
        node.label() + ": provide a valid output name");
    require(
        node.selector() == null || node.selector().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
        declaration,
        "Selector expression exceeds " + EXPRESSION_LIMIT);
  }

  private void checkPin(Node node) {
    var declaration = new NodeDeclaration(node);
    // A draft may choose a rule before its version (ARC Script `use "rule-id";`), not the reverse.
    require(
        node.version() == null || node.ruleId() != null,
        declaration,
        node.label() + ": choose a rule before its version");
    require(
        node.version() == null || node.version() > 0,
        declaration,
        node.label() + ": rule versions start at 1");
  }

  /**
   * Case IDs name a Switch's handles, so they are structure; labels and expressions are content.
   */
  private void checkCases(Node node, NodeKind kind) {
    if (node.cases() == null) return;
    // Cases on another kind are an unused property, which only the content checks report.
    if (!contentChecks && !kind.uses(Property.CASES)) return;
    requireAtMost(
        node.cases(),
        Limits.MAX_SWITCH_CASES,
        option -> new SwitchCase(node, option),
        "Provide at most " + Limits.MAX_SWITCH_CASES + " cases");
    var caseIds = new HashSet<String>();
    for (BranchCase option : node.cases()) {
      var switchCase = new SwitchCase(node, option);
      require(
          option != null
              && option.id() != null
              && CASE_ID.matcher(option.id()).matches()
              && caseIds.add(option.id()),
          switchCase,
          "Every case needs a unique, stable ID");
      if (!contentChecks) continue;
      require(
          option.label() != null
              && !option.label().isBlank()
              && option.label().length() <= Limits.MAX_LABEL_CHARACTERS,
          switchCase,
          "Every case needs a label of 1 to " + Limits.MAX_LABEL_CHARACTERS + " characters");
      require(
          option.expression() != null
              && option.expression().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
          switchCase,
          "Case expression exceeds " + EXPRESSION_LIMIT + " or is missing");
    }
  }

  private void checkFields(Node node) {
    if (node.fields() == null) return;
    requireAtMost(
        node.fields(),
        Limits.MAX_TRANSFORM_FIELDS,
        field -> new TransformField(node, field),
        "Provide at most " + Limits.MAX_TRANSFORM_FIELDS + " transform fields");
    var fieldNames = new HashSet<String>();
    for (Field field : node.fields()) {
      var transformField = new TransformField(node, field);
      require(
          field != null
              && field.name() != null
              && !field.name().isBlank()
              && field.name().length() <= Limits.MAX_FIELD_NAME_CHARACTERS
              && fieldNames.add(field.name()),
          transformField,
          "Transform fields need unique names of 1 to "
              + Limits.MAX_FIELD_NAME_CHARACTERS
              + " characters");
      require(
          field.expression() != null
              && field.expression().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
          transformField,
          "Field expression exceeds " + EXPRESSION_LIMIT + " or is missing");
    }
    require(
        node.fields().isEmpty() || node.expression() == null,
        new NodeDeclaration(node),
        "Transform uses either field mappings or one expression, not both");
  }

  private void checkBindings(Node node) {
    var declaration = new NodeDeclaration(node);
    require(
        node.bindings() == null || node.bindings().size() <= Limits.MAX_REFERENCE_BINDINGS,
        declaration,
        "Provide at most " + Limits.MAX_REFERENCE_BINDINGS + " parameter bindings");
    if (node.bindings() != null)
      for (var binding : node.bindings().entrySet()) {
        require(
            Identifiers.isValid(binding.getKey())
                && binding.getValue() != null
                && binding.getValue().length() <= Limits.MAX_EXPRESSION_CHARACTERS,
            declaration,
            "Invalid parameter binding");
      }
  }

  private void checkEdges(List<Edge> edges, Set<String> ids) {
    Set<String> edgeIds = new HashSet<>();
    for (Edge edge : edges) {
      var connection = new Connection(edge);
      require(
          edge != null
              && edge.id() != null
              && edge.id().length() <= Limits.MAX_EDGE_ID_CHARACTERS
              && edgeIds.add(edge.id()),
          connection,
          "Every connection needs a unique ID");
      require(
          ids.contains(edge.source()) && ids.contains(edge.target()),
          connection,
          "Connection refers to a missing node");
      require(
          edge.sourceHandle() != null
              && (Handles.FIXED.contains(edge.sourceHandle())
                  || CASE_HANDLE.matcher(edge.sourceHandle()).matches()),
          connection,
          "Invalid connection handle");
    }
  }

  /** Where a property may appear, e.g. "Cases belong to Switch nodes". */
  private static String belongsTo(Property property) {
    var owners = new ArrayList<String>();
    for (NodeKind kind : NodeKind.values()) if (kind.uses(property)) owners.add(title(kind));
    String names =
        owners.size() == 1
            ? owners.getFirst()
            : String.join(", ", owners.subList(0, owners.size() - 1)) + " and " + owners.getLast();
    return plural(property) + " belong to " + names + " nodes";
  }

  private static String plural(Property property) {
    return switch (property) {
      case EXPRESSION -> "Expressions";
      case OUTPUT -> "Result variables";
      case RULE -> "Rule references";
      case BINDINGS -> "Parameter bindings";
      case SELECTOR -> "Selectors";
      case CASES -> "Cases";
      case FIELDS -> "Fields";
      case OUTPUT_NAME -> "Output names";
    };
  }

  /** A kind as messages name it, e.g. "Formula". */
  private static String title(NodeKind kind) {
    return kind.name().charAt(0) + kind.name().substring(1).toLowerCase(Locale.ROOT);
  }

  /** A list over its limit is reported at its first extra element. */
  private static <T> void requireAtMost(
      List<T> items, int limit, Function<T, Element> element, String message) {
    if (items.size() > limit) throw violation(element.apply(items.get(limit)), message);
  }

  static void require(boolean condition, Element element, String message) {
    if (!condition) throw violation(element, message);
  }

  /** Thrown to end a check at its first violation; {@link #firstViolation} returns it. */
  static RuntimeException violation(Element element, String message) {
    return new Violated(new ShapeViolation(message, element));
  }

  private static final class Violated extends RuntimeException {
    private final ShapeViolation violation;

    Violated(ShapeViolation violation) {
      super(violation.message(), null, false, false);
      this.violation = violation;
    }
  }
}
