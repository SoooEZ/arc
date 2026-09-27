package dev.arc.engine.script;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.validation.Validator;
import java.util.List;
import org.junit.jupiter.api.Test;

class IdentifierScriptTest {
  private final ArcScript script = new ArcScript(new ObjectMapper(), new Validator());

  @Test
  void nodeResultDeclarationsRejectInvalidNamesInWholeGraphAndNodeBuilds() {
    for (String type : List.of("FORMULA", "TRANSFORM", "REFERENCE")) {
      String declaration = type.equals("FORMULA") ? "let value = 1;" : "as value;";
      String source = "node result " + type + " \"Result\" {\n  " + declaration + "\n}";
      var original = script.build(source);
      assertThat(original.diagnostics()).isEmpty();
      for (String name : List.of("unit price", "$value", "@value", "true", "a".repeat(65))) {
        String invalid = source.replace("value", name);
        var built = script.build(invalid);
        assertThat(built.definition()).as(type + " " + name).isNull();
        assertThat(built.source()).isEqualTo(invalid);
        assertThat(built.diagnostics()).hasSize(1);
        assertThat(built.diagnostics().getFirst().line()).isEqualTo(2);
        var fragment = script.buildNode(original.definition(), "result", invalid);
        assertThat(fragment.definition()).isNull();
        assertThat(fragment.diagnostics()).isEqualTo(built.diagnostics());
      }
    }
  }

  @Test
  void inputAndReferenceParametersCannotBypassIdentifierPolicyThroughCode() {
    for (String name : List.of("unit price", "$value", "@value", "null", "a".repeat(65))) {
      assertThat(
              script
                  .build("inputs { " + name + ": NUMBER required; } node in INPUT \"In\" {}")
                  .definition())
          .as(name)
          .isNull();
      assertThat(
              script
                  .build("node ref REFERENCE \"Ref\" { bind " + name + " = 1; as result; }")
                  .definition())
          .as(name)
          .isNull();
      assertThat(
              script
                  .build(
                      "inputs { value: NUMBER required; source value = {\"id\":\"provider\",\"version\":1,\"bindings\":{\""
                          + name
                          + "\":\"1\"},\"onError\":\"FAIL\"}; } node in INPUT \"In\" {}")
                  .definition())
          .as(name)
          .isNull();
    }
    assertThat(
            script
                .build(
                    "inputs { ROUND: NUMBER required; } node calc FORMULA \"Calc\" { let _result2 = $ROUND(ROUND, 2); }")
                .diagnostics())
        .isEmpty();
  }

  @Test
  void literalObjectKeysAreNotVariableDeclarations() {
    var built =
        script.build(
            "node transform TRANSFORM \"Transform\" { field \"unit price $ @\" = 1; as data; }");
    assertThat(built.diagnostics()).isEmpty();
    assertThat(script.build(built.source()).definition()).isEqualTo(built.definition());
  }
}
