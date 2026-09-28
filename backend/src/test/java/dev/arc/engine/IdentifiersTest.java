package dev.arc.engine;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.expression.Expressions;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class IdentifiersTest {
  private static final String LONGEST_ID = "a" + "-9".repeat(39) + "z";

  @Test
  void resourceIdsAreLowercaseSlugsOfAtMost80Characters() {
    assertThat(LONGEST_ID).hasSize(Limits.MAX_RESOURCE_ID_CHARACTERS);
    for (String valid : List.of("a", "tax-rate", "a1-", LONGEST_ID))
      assertThat(Identifiers.isResourceId(valid)).as(valid).isTrue();
    var invalid = new ArrayList<String>();
    Collections.addAll(invalid, "", "1rate", "-rate", "Rate", "tax_rate", "tax rate", "tax.rate");
    Collections.addAll(invalid, "taxé", LONGEST_ID + "a");
    invalid.add(null);
    for (String id : invalid) assertThat(Identifiers.isResourceId(id)).as(id).isFalse();
  }

  /** Formula calls, source pins and Reference pins accept every ID that creation accepts. */
  @Test
  void formulaCallsSourcePinsAndReferencePinsFollowTheResourceIdPolicy() {
    var validator = new Validator();
    Expressions.compile("@" + LONGEST_ID + ":1()");
    validator.shape(sourcedBy(LONGEST_ID));
    validator.shape(referencing(LONGEST_ID));
    for (String id : List.of(LONGEST_ID + "a", "Rate")) {
      assertThatThrownBy(() -> Expressions.compile("@" + id + ":1()"))
          .hasMessage("Formula call needs a valid rule ID");
      assertThatThrownBy(() -> validator.shape(sourcedBy(id)))
          .hasMessage("Source needs an ID and version");
      assertThatThrownBy(() -> validator.shape(referencing(id)))
          .hasMessage("Reuse: choose a valid rule ID");
    }
  }

  private static Definition referencing(String ruleId) {
    return new Definition(
        1,
        List.of(),
        List.of(
            inputNode("in", "Input"),
            nodeOf("reuse", "REFERENCE", "Reuse").rule(ruleId, 1).build()),
        List.of());
  }

  private static Definition sourcedBy(String sourceId) {
    var binding = new SourceBinding(sourceId, 1, Map.of(), "", "FAIL");
    return new Definition(
        1,
        List.of(new Input("rate", "NUMBER", false, null, binding)),
        List.of(inputNode("in", "Input")),
        List.of());
  }
}
