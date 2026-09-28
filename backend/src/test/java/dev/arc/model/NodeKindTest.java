package dev.arc.model;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.model.Definition.BranchCase;
import dev.arc.model.NodeKind.Property;
import dev.arc.model.NodeKind.Slot;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class NodeKindTest {
  @Test
  void jsonTypesNameTheKindsExactly() {
    assertThat(Arrays.stream(NodeKind.values()).map(NodeKind::name))
        .containsExactly(
            "INPUT", "FORMULA", "CONDITION", "SWITCH", "TRANSFORM", "REFERENCE", "OUTPUT");
    assertThat(NodeKind.parse("SWITCH")).contains(NodeKind.SWITCH);
    for (String unknown : Arrays.asList(null, "", "switch", "Switch", " SWITCH", "LOOP"))
      assertThat(NodeKind.parse(unknown)).as(String.valueOf(unknown)).isEmpty();
    assertThatThrownBy(() -> nodeOf("loop", "LOOP", "Loop").build().kind())
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("Unknown node type: LOOP");
  }

  @Test
  void onlyFormulasTransformsAndReferencesStoreAResult() {
    for (NodeKind kind : NodeKind.values())
      assertThat(kind.storesResult())
          .as(kind.name())
          .isEqualTo(
              Set.of(NodeKind.FORMULA, NodeKind.TRANSFORM, NodeKind.REFERENCE).contains(kind));
  }

  /** A result variable is the property of the kinds that store a result; every slot is one. */
  @Test
  void propertiesCoverTheResultVariableAndEveryExpressionSlot() {
    var slotProperties =
        Map.of(
            Slot.EXPRESSION, Property.EXPRESSION,
            Slot.SELECTOR, Property.SELECTOR,
            Slot.CASES, Property.CASES,
            Slot.FIELDS, Property.FIELDS,
            Slot.BINDINGS, Property.BINDINGS);
    for (NodeKind kind : NodeKind.values()) {
      assertThat(kind.uses(Property.OUTPUT)).as(kind.name()).isEqualTo(kind.storesResult());
      for (Slot slot : kind.slots())
        assertThat(kind.uses(slotProperties.get(slot))).as(kind + " " + slot).isTrue();
    }
    assertThat(NodeKind.REFERENCE.uses(Property.RULE)).isTrue();
    assertThat(NodeKind.OUTPUT.properties())
        .containsExactlyInAnyOrder(Property.EXPRESSION, Property.OUTPUT_NAME);
    assertThat(NodeKind.INPUT.properties()).isEmpty();
  }

  @Test
  void handlesFollowEachKindsExitRuleInCanvasOrder() {
    var cases = List.of(new BranchCase("big", "Big", "true"), new BranchCase("small", "S", "true"));
    for (NodeKind kind :
        List.of(NodeKind.INPUT, NodeKind.FORMULA, NodeKind.TRANSFORM, NodeKind.REFERENCE))
      assertThat(kind.handles(null)).as(kind.name()).containsExactly("next");
    assertThat(NodeKind.CONDITION.handles(null)).containsExactly("true", "false");
    assertThat(NodeKind.SWITCH.handles(cases)).containsExactly("case:big", "case:small", "default");
    assertThat(NodeKind.SWITCH.handles(null)).containsExactly("default");
    assertThat(NodeKind.OUTPUT.handles(null)).isEmpty();
    assertThat(nodeOf("s", "SWITCH", "S").cases(cases).build().handles())
        .containsExactly("case:big", "case:small", "default");
    assertThat(Handles.FIXED).containsExactly("next", "true", "false", "default");
    assertThat(Handles.condition(true)).isEqualTo("true");
    assertThat(Handles.condition(false)).isEqualTo("false");
    assertThat(Handles.forCase("premium")).isEqualTo("case:premium");
  }

  @Test
  void onlyConditionsAndSwitchesChooseOneExit() {
    for (NodeKind kind : NodeKind.values())
      assertThat(kind.choosesOneExit())
          .as(kind.name())
          .isEqualTo(kind == NodeKind.CONDITION || kind == NodeKind.SWITCH);
  }

  @Test
  void eachKindOwnsTheExpressionSlotsItEvaluates() {
    assertThat(NodeKind.INPUT.slots()).isEmpty();
    for (NodeKind kind : List.of(NodeKind.FORMULA, NodeKind.CONDITION, NodeKind.OUTPUT))
      assertThat(kind.slots()).as(kind.name()).containsExactly(Slot.EXPRESSION);
    assertThat(NodeKind.SWITCH.slots()).containsExactlyInAnyOrder(Slot.SELECTOR, Slot.CASES);
    assertThat(NodeKind.TRANSFORM.slots()).containsExactlyInAnyOrder(Slot.FIELDS, Slot.EXPRESSION);
    assertThat(NodeKind.REFERENCE.slots()).containsExactly(Slot.BINDINGS);
    assertThat(NodeKind.REFERENCE.owns(Slot.BINDINGS)).isTrue();
    assertThat(NodeKind.FORMULA.owns(Slot.BINDINGS)).isFalse();
  }
}
