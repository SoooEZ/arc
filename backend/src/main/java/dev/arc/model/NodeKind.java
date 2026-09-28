package dev.arc.model;

import dev.arc.model.Definition.BranchCase;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The node types of graph schema 1; a node's JSON {@code type} is the constant's name. Each fact
 * below is an exhaustive switch, so adding a kind fails to compile until every fact, and every
 * switch over the kinds in validation, scope analysis, execution and ARC Script, decides how the
 * new kind behaves.
 */
public enum NodeKind {
  INPUT,
  FORMULA,
  CONDITION,
  SWITCH,
  TRANSFORM,
  REFERENCE,
  OUTPUT;

  /** A node field that holds expressions. */
  public enum Slot {
    /** The node's own {@code expression}. */
    EXPRESSION,
    /** A Switch's optional {@code selector}. */
    SELECTOR,
    /** The expressions of a Switch's {@code cases}. */
    CASES,
    /** The expressions of a Transform's {@code fields}. */
    FIELDS,
    /** The parameter {@code bindings} of a Reference. */
    BINDINGS
  }

  /**
   * An optional node property beyond {@code id}, {@code type}, {@code label} and {@code position}.
   * Every expression {@link Slot} is one, and so are the result variable, the pinned rule and an
   * Output's name.
   */
  public enum Property {
    /** {@code expression} */
    EXPRESSION,
    /** {@code output}, the result variable. */
    OUTPUT,
    /** {@code ruleId} and {@code version}, the pinned rule. */
    RULE,
    /** {@code bindings} */
    BINDINGS,
    /** {@code selector} */
    SELECTOR,
    /** {@code cases} */
    CASES,
    /** {@code fields} */
    FIELDS,
    /** {@code outputName} */
    OUTPUT_NAME
  }

  /** The kind a JSON {@code type} names exactly; empty for null, unknown or differently cased. */
  public static Optional<NodeKind> parse(String type) {
    for (NodeKind kind : values()) if (kind.name().equals(type)) return Optional.of(kind);
    return Optional.empty();
  }

  /** Whether a node of this kind assigns its {@code output} variable for downstream nodes. */
  public boolean storesResult() {
    return switch (this) {
      case FORMULA, TRANSFORM, REFERENCE -> true;
      case INPUT, CONDITION, SWITCH, OUTPUT -> false;
    };
  }

  /**
   * The handles a node of this kind connects, in canvas order: {@code next}; {@code true} then
   * {@code false}; a Switch's case handles in priority order, then {@code default}; or none for an
   * Output.
   */
  public List<String> handles(List<BranchCase> cases) {
    return switch (this) {
      case INPUT, FORMULA, TRANSFORM, REFERENCE -> List.of(Handles.NEXT);
      case CONDITION -> List.of(Handles.TRUE, Handles.FALSE);
      case SWITCH -> Handles.ofSwitch(cases);
      case OUTPUT -> List.of();
    };
  }

  /**
   * Whether a run activates exactly one exit, chosen by a Condition's value or by a Switch's first
   * matching case. Other kinds activate every exit whenever they run.
   */
  public boolean choosesOneExit() {
    return switch (this) {
      case CONDITION, SWITCH -> true;
      case INPUT, FORMULA, TRANSFORM, REFERENCE, OUTPUT -> false;
    };
  }

  /**
   * The expression slots a node of this kind owns. A Transform uses its field expressions, or its
   * own expression when it has no fields.
   */
  public Set<Slot> slots() {
    return switch (this) {
      case INPUT -> Set.of();
      case FORMULA, CONDITION, OUTPUT -> Set.of(Slot.EXPRESSION);
      case SWITCH -> Set.of(Slot.SELECTOR, Slot.CASES);
      case TRANSFORM -> Set.of(Slot.FIELDS, Slot.EXPRESSION);
      case REFERENCE -> Set.of(Slot.BINDINGS);
    };
  }

  public boolean owns(Slot slot) {
    return slots().contains(slot);
  }

  /** Each kind's property set, computed once from the exhaustive switch below. */
  private static final Map<NodeKind, Set<Property>> PROPERTIES = propertySets();

  private static Map<NodeKind, Set<Property>> propertySets() {
    var sets = new EnumMap<NodeKind, Set<Property>>(NodeKind.class);
    for (NodeKind kind : values()) sets.put(kind, kind.ownProperties());
    return sets;
  }

  /**
   * The optional properties a node of this kind may set. Draft-shape validation rejects a node that
   * sets any other, including in stored drafts and published versions.
   */
  public Set<Property> properties() {
    return PROPERTIES.get(this);
  }

  private Set<Property> ownProperties() {
    return switch (this) {
      case INPUT -> Set.of();
      case FORMULA -> Set.of(Property.EXPRESSION, Property.OUTPUT);
      case CONDITION -> Set.of(Property.EXPRESSION);
      case SWITCH -> Set.of(Property.SELECTOR, Property.CASES);
      case TRANSFORM -> Set.of(Property.FIELDS, Property.EXPRESSION, Property.OUTPUT);
      case REFERENCE -> Set.of(Property.RULE, Property.BINDINGS, Property.OUTPUT);
      case OUTPUT -> Set.of(Property.EXPRESSION, Property.OUTPUT_NAME);
    };
  }

  public boolean uses(Property property) {
    return properties().contains(property);
  }
}
