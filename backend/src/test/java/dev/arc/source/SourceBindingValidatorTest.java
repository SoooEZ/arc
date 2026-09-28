package dev.arc.source;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceBindingValidatorTest {
  private final SourceRepository repository = mock(SourceRepository.class);
  private final SourceBindingValidator validator = new SourceBindingValidator(repository);
  private final RuleResolver noRules =
      (id, version) -> {
        throw new AssertionError("Unexpected rule read");
      };
  private final Input sourced =
      new Input(
          "amount",
          "NUMBER",
          false,
          null,
          new SourceBinding("rates", 1, Map.of("wrong", "1"), null, "FAIL"));

  SourceBindingValidatorTest() {
    var rates =
        new SourceDefinition(
            "LOOKUP", null, List.of(new Input("key", "STRING", true, null)), Map.of(), null, 1000);
    when(repository.get("rates", 1)).thenReturn(new DataSource("rates", "Rates", 1, rates));
  }

  private Definition draft(List<Node> nodes) {
    return new Definition(1, List.of(sourced), nodes, List.of());
  }

  @Test
  void mappingProblemsAppearOnTheInputNodeAndADraftWithoutOneStillGetsTheProblem() {
    var withInput = draft(List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")));
    assertThatThrownBy(() -> validator.validate(withInput, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo("Unknown source parameter: wrong");
              assertThat(error.locations())
                  .containsExactly(new Location(null, null, "in", "Inputs"));
            });

    var withoutInput = draft(List.of(outputNode("out", "Out", "1")));
    assertThatThrownBy(() -> validator.validate(withoutInput, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage()).isEqualTo("Unknown source parameter: wrong");
              assertThat(error.locations()).isEmpty();
            });
  }

  @Test
  void theNestingLimitIsCheckedOnEveryPathWhateverTheNodeOrder() {
    // With one visit per pin, m's child c0 was skipped as already visited at depth 1, so the root
    // was accepted and published, then failed every execution with the nesting limit.
    var rules = new HashMap<String, Definition>();
    for (int level = 0; level <= 15; level++)
      rules.put("c" + level, level == 15 ? leaf() : referencing("c" + (level + 1)));
    rules.put("m", referencing("c0"));
    RuleResolver resolver = (id, version) -> rules.get(id);
    var direct = nodeOf("direct", "REFERENCE", "Direct").rule("c0", 1).output("a").build();
    var viaM = nodeOf("via", "REFERENCE", "Via").rule("m", 1).output("b").build();
    for (List<Node> order : List.of(List.of(direct, viaM), List.of(viaM, direct))) {
      var nodes = new ArrayList<Node>(List.of(inputNode("in", "Inputs")));
      nodes.addAll(order);
      nodes.add(outputNode("out", "Out", "1"));
      var root = new Definition(1, List.of(), nodes, List.of());
      assertThatThrownBy(() -> validator.validate(root, resolver))
          .as(order.toString())
          .hasMessage("Rule nesting exceeds 16 levels");
    }
    // A chain of exactly 16 levels below the root is accepted (lesson B3: both sides).
    var deepest =
        new Definition(
            1,
            List.of(),
            List.of(inputNode("in", "Inputs"), direct, outputNode("out", "Out", "1")),
            List.of());
    validator.validate(deepest, resolver);
  }

  private static Definition referencing(String ruleId) {
    return new Definition(
        1,
        List.of(),
        List.of(
            inputNode("in", "Inputs"),
            nodeOf("ref", "REFERENCE", "Ref").rule(ruleId, 1).output("r").build(),
            outputNode("out", "Out", "r")),
        List.of());
  }

  private static Definition leaf() {
    return new Definition(
        1, List.of(), List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")), List.of());
  }
}
