package dev.arc.engine.validation;

import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.SortedSet;

/**
 * Why an expression reads a variable it cannot: in words that say what to do, and, for one close
 * misspelling, the name that was probably meant ({@link NameSuggestions}).
 */
final class ScopeMessages {
  private ScopeMessages() {}

  /**
   * Why a node's expression cannot read some variables, in words that say what to do. A name that
   * no input or result variable of the graph declares is told apart from one that some step sets
   * but not every path into this node: renaming an input left its old name in every expression that
   * read it, which the scope plan alone reported as unavailable on an incoming path. A single
   * undeclared name that closely matches a declared one asks whether that one was meant ({@link
   * NameSuggestions}).
   */
  static String unavailableAtNode(SortedSet<String> unknown, Definition definition) {
    // Declaration order, which breaks ties between equally close suggestions.
    var declared = new LinkedHashSet<String>();
    for (Input input : definition.inputs()) declared.add(input.name());
    for (Node node : definition.nodes())
      if (node.storesResult() && node.resultName() != null) declared.add(node.resultName());
    var undeclared = new ArrayList<String>();
    var unset = new ArrayList<String>();
    for (String name : unknown) {
      if (declared.contains(name)) unset.add(name);
      else undeclared.add(name);
    }
    var sentences = new ArrayList<String>();
    if (undeclared.size() == 1) {
      String name = undeclared.getFirst();
      String meant = NameSuggestions.closest(name, declared);
      sentences.add(
          "uses "
              + name
              + ", which no input or result variable provides; "
              + (meant == null
                  ? "correct the name or add an input named " + name + "."
                  : "did you mean " + meant + "?"));
    } else if (!undeclared.isEmpty())
      sentences.add(
          "uses "
              + Wording.listed(undeclared)
              + ", which no input or result variable provides; correct the names or add inputs"
              + " with those names.");
    if (!unset.isEmpty())
      sentences.add(
          (undeclared.isEmpty() ? "uses " : "It also uses ")
              + Wording.listed(unset)
              + (unset.size() == 1 ? ", which is not set" : ", which are not set")
              + " on every path into this step; set "
              + (unset.size() == 1 ? "it" : "them")
              + " on each path that leads here.");
    return withoutFinalPeriod(String.join(" ", sentences));
  }

  /**
   * Why a source mapping cannot read some names: it reads the rule's declared inputs alone. A
   * single name that closely matches an input asks whether that input was meant.
   */
  static String unavailableToSourceMapping(SortedSet<String> unknown, Definition definition) {
    if (unknown.size() == 1) {
      var inputs = new ArrayList<String>();
      for (Input input : definition.inputs()) inputs.add(input.name());
      String meant = NameSuggestions.closest(unknown.first(), inputs);
      if (meant != null)
        return "uses "
            + unknown.first()
            + ", which is not an input of this rule; did you mean "
            + meant
            + "?";
    }
    return "uses "
        + Wording.listed(new ArrayList<>(unknown))
        + (unknown.size() == 1
            ? ", which is not an input of this rule"
            : ", which are not inputs of this rule")
        + "; a source mapping reads only inputs";
  }

  /**
   * Problems end without a period, as every other validation message does, so only a question keeps
   * its mark.
   */
  private static String withoutFinalPeriod(String message) {
    return message.endsWith(".") ? message.substring(0, message.length() - 1) : message;
  }
}
