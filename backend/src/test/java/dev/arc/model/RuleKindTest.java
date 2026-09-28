package dev.arc.model;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class RuleKindTest {
  @Test
  void namesAreParsedExactlyAndListedAsTheChoiceMessagesShow() {
    assertThat(Arrays.stream(RuleKind.values()).map(RuleKind::name))
        .containsExactly("DECISION_TREE", "FORMULA", "RULE");
    assertThat(RuleKind.parse("FORMULA")).contains(RuleKind.FORMULA);
    for (String unknown : Arrays.asList(null, "", "formula", "Formula", " FORMULA", "LOOP"))
      assertThat(RuleKind.parse(unknown)).as(String.valueOf(unknown)).isEmpty();
    assertThat(RuleKind.choices()).isEqualTo("DECISION_TREE, FORMULA, or RULE");
  }

  @Test
  void onlyFormulasCanBeCalledFromExpressions() {
    for (RuleKind kind : RuleKind.values())
      assertThat(kind.callableByFormula()).as(kind.name()).isEqualTo(kind == RuleKind.FORMULA);
  }
}
