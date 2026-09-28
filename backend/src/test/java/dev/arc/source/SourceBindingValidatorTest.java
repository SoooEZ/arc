package dev.arc.source;

import static dev.arc.support.GraphFixtures.inputNode;
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
}
