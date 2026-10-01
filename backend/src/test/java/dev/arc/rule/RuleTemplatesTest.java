package dev.arc.rule;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.NodeKind;
import dev.arc.model.RuleKind;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The graphs new rules start from: decided per kind, valid, and editable as code. */
class RuleTemplatesTest {
  private final Validator validator = new Validator();
  private final RuleResolver noRules =
      (id, version) -> {
        throw new ArcException(404, "Published version not found");
      };

  /** Every kind starts from a decided template: a Condition for a RULE, a calculation otherwise. */
  @Test
  void eachKindStartsFromItsTemplate() {
    var rule = RuleTemplates.blank(RuleKind.RULE);
    assertThat(rule.nodesOf(NodeKind.CONDITION)).hasSize(1);
    assertThat(rule.nodesOf(NodeKind.OUTPUT)).hasSize(2);
    for (RuleKind kind : List.of(RuleKind.FORMULA, RuleKind.DECISION_TREE)) {
      var calculation = RuleTemplates.blank(kind);
      assertThat(calculation).as(kind.name()).isEqualTo(RuleTemplates.blank(RuleKind.FORMULA));
      assertThat(calculation.nodesOf(NodeKind.FORMULA)).as(kind.name()).hasSize(1);
      assertThat(calculation.nodesOf(NodeKind.CONDITION)).as(kind.name()).isEmpty();
    }
  }

  /** A new rule can be published as it starts, and opens in the code view without a change. */
  @Test
  void templatesAreValidAndBuildBackFromTheirCode() {
    var script = new ArcScript(new ObjectMapper(), validator);
    for (RuleKind kind : RuleKind.values()) {
      var template = RuleTemplates.blank(kind);
      validator.validate(template, noRules);
      var build = script.build(script.render(template));
      assertThat(build.diagnostics()).as(kind.name()).isEmpty();
      assertThat(build.definition()).as(kind.name()).isEqualTo(template);
    }
  }
}
