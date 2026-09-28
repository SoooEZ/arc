package dev.arc.engine.validation;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Diagnostics of one pass in report order. Each check labels and locates its own problems once, so
 * the same fault yields the same problem and is kept once.
 */
final class Problems {
  private final Definition definition;
  private final Set<Validator.Problem> problems = new LinkedHashSet<>();

  Problems(Definition definition) {
    this.definition = definition;
  }

  void add(ArcException error) {
    problems.add(Validator.Problem.from(onInputNode(error, definition)));
  }

  List<Validator.Problem> list() {
    return List.copyOf(problems);
  }

  /**
   * Problems of the whole graph or of its declared inputs have no node of their own; the editor
   * shows them on the Input node (see {@link Definition#inputNode}). Errors that already have a
   * location, and those of a document without an Input node, are returned unchanged.
   */
  static ArcException onInputNode(ArcException error, Definition definition) {
    if (!error.locations().isEmpty() || definition == null) return error;
    return definition
        .inputNode()
        .map(input -> error.atNode(null, null, input.id(), input.label()))
        .orElse(error);
  }
}
