package dev.arc.engine.script;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.TreeMap;

/** Canonical text formatting, shared by whole-graph and single-node editing. */
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
            || definition.nodes().stream()
                .anyMatch(node -> node.id().equals(nodeId) && node.type().equals("INPUT"));
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
    out.append(" {\n");
    switch (node.type()) {
      case "FORMULA" ->
          out.append("  let ")
              .append(node.output() == null ? "result" : node.output())
              .append(" = ")
              .append(node.expression() == null ? "0" : node.expression())
              .append(";\n");
      case "SWITCH" -> {
        if (node.selector() != null) out.append("  select ").append(node.selector()).append(";\n");
        if (node.cases() != null)
          for (BranchCase option : node.cases())
            out.append("  case ")
                .append(write(option.id()))
                .append(' ')
                .append(write(option.label()))
                .append(node.selector() == null ? " when " : " equals ")
                .append(option.expression())
                .append(";\n");
      }
      case "TRANSFORM" -> {
        if (node.fields() != null && !node.fields().isEmpty()) {
          for (Field field : node.fields())
            out.append("  field ")
                .append(write(field.name()))
                .append(" = ")
                .append(field.expression())
                .append(";\n");
          out.append("  as ").append(node.output() == null ? "data" : node.output()).append(";\n");
        } else {
          out.append("  let ")
              .append(node.output() == null ? "data" : node.output())
              .append(" = ")
              .append(node.expression() == null ? "OBJECT()" : node.expression())
              .append(";\n");
        }
      }
      case "CONDITION" ->
          out.append("  when ")
              .append(node.expression() == null ? "true" : node.expression())
              .append(";\n");
      case "OUTPUT" ->
          out.append("  return ")
              .append(node.expression() == null ? "null" : node.expression())
              .append(";\n");
      case "REFERENCE" -> {
        if (node.ruleId() != null && node.version() != null)
          out.append("  use ")
              .append(write(node.ruleId()))
              .append(" version ")
              .append(node.version())
              .append(";\n");
        if (node.bindings() != null)
          new TreeMap<>(node.bindings())
              .forEach(
                  (key, value) ->
                      out.append("  bind ").append(key).append(" = ").append(value).append(";\n"));
        out.append("  as ").append(node.output() == null ? "result" : node.output()).append(";\n");
      }
      default -> {}
    }
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

  private String write(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (JsonProcessingException failure) {
      throw new IllegalStateException("Cannot render graph value as JSON", failure);
    }
  }
}
