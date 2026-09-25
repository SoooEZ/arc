package dev.arc.engine.validation;

import dev.arc.engine.Identifiers;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;

/** Stored draft shape and size limits, independent of whether the graph can execute. */
final class DefinitionShape {
  private static final Set<String> TYPES =
      Set.of("INPUT", "FORMULA", "CONDITION", "SWITCH", "TRANSFORM", "REFERENCE", "OUTPUT");

  void validate(Definition definition) {
    validateDocumentLimits(definition);
    Set<String> nodeIds = validateNodes(definition.nodes());
    validateEdges(definition.edges(), nodeIds);
    InputValidation.validateSchema(definition.inputs());
  }

  private void validateDocumentLimits(Definition definition) {
    require(definition != null, "Definition is required");
    require(definition.schemaVersion() == 1, "Only schemaVersion 1 is supported");
    require(
        definition.inputs() != null && definition.inputs().size() <= 50,
        "Provide at most 50 inputs");
    require(
        definition.nodes() != null
            && !definition.nodes().isEmpty()
            && definition.nodes().size() <= 100,
        "Provide 1 to 100 nodes");
    require(
        definition.edges() != null && definition.edges().size() <= 200,
        "Provide at most 200 edges");
    require(
        definition.notes() == null
            || definition.notes().size() <= 500
                && definition.notes().stream()
                    .allMatch(note -> note != null && note.length() <= 2000),
        "Too many or oversized comments");
  }

  private Set<String> validateNodes(List<Node> nodes) {
    Set<String> ids = new HashSet<>();
    for (Node node : nodes) validateNode(node, ids);
    return ids;
  }

  private void validateNode(Node node, Set<String> ids) {
    try {
      require(
          node != null && node.id() != null && node.id().matches("[A-Za-z0-9_-]{1,80}"),
          "Every node needs a valid ID");
      require(
          node.position() == null
              || Double.isFinite(node.position().x())
                  && Double.isFinite(node.position().y())
                  && Math.abs(node.position().x()) <= 1_000_000
                  && Math.abs(node.position().y()) <= 1_000_000,
          "Node position must be finite and within canvas bounds");
      require(ids.add(node.id()), "Duplicate node ID: " + node.id());
      require(
          TYPES.contains(node.type() == null ? "" : node.type()),
          "Unknown node type: " + node.type());
      require(
          node.label() != null && !node.label().isBlank() && node.label().length() <= 160,
          "Every node needs a label of 1 to 160 characters");
      require(
          node.expression() == null || node.expression().length() <= 2000,
          "Expression exceeds 2,000 characters");
      require(node.cases() == null || node.type().equals("SWITCH"), "Cases belong to Switch nodes");
      require(
          node.selector() == null || node.type().equals("SWITCH"),
          "Selectors belong to Switch nodes");
      require(
          node.selector() == null || node.selector().length() <= 2000,
          "Selector expression exceeds 2,000 characters");
      require(
          node.fields() == null || node.type().equals("TRANSFORM"),
          "Fields belong to Transform nodes");
      validateCases(node);
      validateFields(node);
      validateBindings(node);
    } catch (ArcException error) {
      throw node == null ? error : error.atNode(null, null, node.id(), node.label());
    }
  }

  private void validateCases(Node node) {
    if (node.cases() == null) return;
    require(node.cases().size() <= 20, "Provide at most 20 cases");
    var caseIds = new HashSet<String>();
    for (BranchCase option : node.cases()) {
      require(
          option != null
              && option.id() != null
              && option.id().matches("[A-Za-z0-9_-]{1,64}")
              && caseIds.add(option.id()),
          "Every case needs a unique, stable ID");
      require(
          option.label() != null && !option.label().isBlank() && option.label().length() <= 160,
          "Every case needs a label of 1 to 160 characters");
      require(
          option.expression() != null && option.expression().length() <= 2000,
          "Case expression exceeds 2,000 characters or is missing");
    }
  }

  private void validateFields(Node node) {
    if (node.fields() == null) return;
    require(node.fields().size() <= 50, "Provide at most 50 transform fields");
    var fieldNames = new HashSet<String>();
    for (Field field : node.fields()) {
      require(
          field != null
              && field.name() != null
              && !field.name().isBlank()
              && field.name().length() <= 160
              && fieldNames.add(field.name()),
          "Transform fields need unique names of 1 to 160 characters");
      require(
          field.expression() != null && field.expression().length() <= 2000,
          "Field expression exceeds 2,000 characters or is missing");
    }
    require(
        node.fields().isEmpty() || node.expression() == null,
        "Transform uses either field mappings or one expression, not both");
  }

  private void validateBindings(Node node) {
    require(
        node.bindings() == null || node.bindings().size() <= 50,
        "Provide at most 50 parameter bindings");
    if (node.bindings() != null)
      for (var binding : node.bindings().entrySet()) {
        require(
            Identifiers.isValid(binding.getKey())
                && binding.getValue() != null
                && binding.getValue().length() <= 2000,
            "Invalid parameter binding");
      }
  }

  private void validateEdges(List<Edge> edges, Set<String> ids) {
    Set<String> edgeIds = new HashSet<>();
    for (Edge edge : edges) {
      require(
          edge != null && edge.id() != null && edge.id().length() <= 100 && edgeIds.add(edge.id()),
          "Every connection needs a unique ID");
      require(
          ids.contains(edge.source()) && ids.contains(edge.target()),
          "Connection refers to a missing node");
      require(
          edge.sourceHandle() != null
              && (Set.of("next", "true", "false", "default").contains(edge.sourceHandle())
                  || edge.sourceHandle().matches("case:[A-Za-z0-9_-]{1,64}")),
          "Invalid connection handle");
    }
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw ArcException.invalid(message);
  }
}
