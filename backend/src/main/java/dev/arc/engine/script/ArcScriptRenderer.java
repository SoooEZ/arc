package dev.arc.engine.script;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import java.util.Map;
import java.util.TreeMap;

/**
 * Canonical text formatting, shared by whole-graph and single-node editing. It writes only what the
 * graph holds: an unset value omits its statement and an empty value is written empty (for example
 * {@code return;}), so building the text gives the same draft back. An empty result or Output name
 * is unset.
 */
final class ArcScriptRenderer {
  private final ObjectMapper json;

  ArcScriptRenderer(ObjectMapper json) {
    this.json = json;
  }

  String render(Definition definition, String nodeId) {
    StringBuilder out = new StringBuilder("schema 1;\n\n");
    if (nodeId == null && definition.notes() != null)
      for (String note : definition.notes())
        for (String line : note.split("\\R", -1)) out.append("// ").append(line).append('\n');
    boolean includeInputs =
        nodeId == null
            || definition.nodesOf(NodeKind.INPUT).stream()
                .anyMatch(input -> input.id().equals(nodeId));
    if (includeInputs) {
      appendInputs(out, definition);
    }
    for (Node node : definition.nodes()) {
      if (nodeId != null && !node.id().equals(nodeId)) continue;
      appendNode(out, node, definition);
    }
    return out.toString();
  }

  private void appendInputs(StringBuilder out, Definition definition) {
    out.append("inputs {\n");
    for (Input input : definition.inputs()) {
      out.append("  ")
          .append(input.name())
          .append(": ")
          .append(input.type())
          .append(input.required() ? " required" : " optional");
      if (input.defaultValue() != null) out.append(" default ").append(write(input.defaultValue()));
      out.append(";\n");
      if (input.source() != null)
        out.append("  source ")
            .append(input.name())
            .append(" = ")
            .append(write(input.source()))
            .append(";\n");
    }
    out.append("}\n");
  }

  private void appendNode(StringBuilder out, Node node, Definition definition) {
    out.append("\nnode ")
        .append(write(node.id()))
        .append(' ')
        .append(node.type())
        .append(' ')
        .append(write(node.label()));
    if (node.position() != null)
      out.append(" at (")
          .append(node.position().x())
          .append(", ")
          .append(node.position().y())
          .append(')');
    out.append(" {\n").append(declarations(node));
    for (Edge edge : definition.edges())
      if (edge.source().equals(node.id()))
        out.append("  ")
            .append(edge.sourceHandle())
            .append(" -> ")
            .append(write(edge.target()))
            .append(" edge ")
            .append(write(edge.id()))
            .append(";\n");
    out.append("}\n");
  }

  /** The statements that declare what a node of its kind holds, before its connections. */
  private String declarations(Node node) {
    return switch (node.kind()) {
      case INPUT -> ""; // The inputs block declares the Input node's parameters.
      case FORMULA -> let(node.output(), node.expression());
      case CONDITION -> statement("when", node.expression());
      case SWITCH -> switchDeclarations(node);
      case TRANSFORM -> transformDeclarations(node);
      case REFERENCE -> referenceDeclarations(node);
      case OUTPUT ->
          statement("return", node.expression()) + statement("as", name(node.outputName()));
    };
  }

  private String switchDeclarations(Node node) {
    var out = new StringBuilder(statement("select", node.selector()));
    String matching = node.selector() == null ? " when" : " equals";
    if (node.cases() != null)
      for (BranchCase option : node.cases())
        out.append(
            statement(
                "case " + write(option.id()) + ' ' + write(option.label()) + matching,
                option.expression()));
    return out.toString();
  }

  /** Field mappings and the result name, or one {@code let} for a whole-value expression. */
  private String transformDeclarations(Node node) {
    boolean fieldMapping = node.fields() != null && !node.fields().isEmpty();
    if (!fieldMapping && node.expression() != null) return let(node.output(), node.expression());
    // A Transform without an expression maps fields, even before its first field exists.
    var out = new StringBuilder();
    if (fieldMapping)
      for (Field field : node.fields())
        out.append(statement("field " + write(field.name()) + " =", field.expression()));
    return out.append(statement("as", name(node.output()))).toString();
  }

  private String referenceDeclarations(Node node) {
    var out = new StringBuilder();
    if (node.ruleId() != null)
      out.append(
          statement(
              "use " + write(node.ruleId()),
              node.version() == null ? "" : "version " + node.version()));
    if (node.bindings() != null)
      for (Map.Entry<String, String> binding : new TreeMap<>(node.bindings()).entrySet())
        out.append(statement("bind " + binding.getKey() + " =", binding.getValue()));
    return out.append(statement("as", name(node.output()))).toString();
  }

  /**
   * {@code let name = expression;} with either part left out while unset: {@code let total;} has no
   * expression yet and {@code let = amount;} no result name.
   */
  private static String let(String output, String expression) {
    String name = name(output);
    if (name == null && expression == null) return "";
    String declaration = name == null ? "let" : "let " + name;
    if (expression == null) return statement(declaration, "");
    return statement(declaration + " =", expression);
  }

  /** {@code start value;}. An empty value is written as nothing; a null value has no statement. */
  private static String statement(String start, String value) {
    if (value == null) return "";
    return "  " + start + (value.isEmpty() ? "" : " " + value) + ";\n";
  }

  /** Result and Output names: empty and missing both mean that no name is chosen yet. */
  private static String name(String name) {
    return name == null || name.isEmpty() ? null : name;
  }

  private String write(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Cannot render graph value as JSON", failure);
    }
  }
}
