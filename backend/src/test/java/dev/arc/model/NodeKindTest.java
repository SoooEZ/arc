package dev.arc.model;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.model.Definition.BranchCase;
import dev.arc.model.NodeKind.Property;
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

  /**
   * {@code properties()} is the one table of what each kind owns: its expressions, result variable,
   * pin and Output name. Storing a result is the same fact as using the result variable.
   */
  @Test
  void eachKindOwnsExactlyItsProperties() {
    var expected =
        Map.of(
            NodeKind.INPUT, Set.<Property>of(),
            NodeKind.FORMULA, Set.of(Property.EXPRESSION, Property.OUTPUT),
            NodeKind.CONDITION, Set.of(Property.EXPRESSION),
            NodeKind.SWITCH, Set.of(Property.SELECTOR, Property.CASES),
            NodeKind.TRANSFORM, Set.of(Property.FIELDS, Property.EXPRESSION, Property.OUTPUT),
            NodeKind.REFERENCE, Set.of(Property.RULE, Property.BINDINGS, Property.OUTPUT),
            NodeKind.OUTPUT, Set.of(Property.EXPRESSION, Property.OUTPUT_NAME));
    for (NodeKind kind : NodeKind.values()) {
      assertThat(kind.properties()).as(kind.name()).isEqualTo(expected.get(kind));
      assertThat(kind.uses(Property.OUTPUT)).as(kind.name()).isEqualTo(kind.storesResult());
      for (Property property : Property.values())
        assertThat(kind.uses(property))
            .as(kind + " " + property)
            .isEqualTo(expected.get(kind).contains(property));
      // The set is computed once; a per-call allocation made draft-shape passes expensive.
      assertThat(kind.properties()).isSameAs(kind.properties());
    }
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
}
