package dev.arc.model;

import dev.arc.model.Definition.BranchCase;
import java.util.ArrayList;
import java.util.List;

/**
 * Connection handle names: the exit an {@link Definition.Edge} leaves its source node from. {@link
 * NodeKind#handles} says which handles a node connects.
 */
public final class Handles {
  /** The only exit of an Input, Formula, Transform or Reference node. */
  public static final String NEXT = "next";

  public static final String TRUE = "true";
  public static final String FALSE = "false";

  /** A Switch's exit when no case matches. */
  public static final String DEFAULT = "default";

  /**
   * A Switch case's handle is this prefix followed by the case ID, such as {@code case:premium}.
   */
  public static final String CASE_PREFIX = "case:";

  /** Every handle whose name does not depend on a node, in canvas order. */
  public static final List<String> FIXED = List.of(NEXT, TRUE, FALSE, DEFAULT);

  private Handles() {}

  /** The exit a Condition takes for its value. */
  public static String condition(boolean value) {
    return value ? TRUE : FALSE;
  }

  public static String forCase(String caseId) {
    return CASE_PREFIX + caseId;
  }

  /** A Switch's exits: its cases in priority order, then {@link #DEFAULT}. */
  static List<String> ofSwitch(List<BranchCase> cases) {
    var handles = new ArrayList<String>();
    if (cases != null) for (BranchCase option : cases) handles.add(forCase(option.id()));
    handles.add(DEFAULT);
    return List.copyOf(handles);
  }
}
