package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class OutputNameTest {
  private final Validator validator = new Validator();
  private final Engine engine = new Engine(validator);
  private final RuleResolver noReferences =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  private Node output(String id, String expression, String name) {
    return nodeOf(id, "OUTPUT", id).expression(expression).outputName(name).build();
  }

  private Definition graph(Node output) {
    return new Definition(
        1,
        List.of(new Input("value", "NUMBER", true, null)),
        List.of(node("input", "INPUT", null, null), output),
        List.of(edge("input", output.id(), "next")));
  }

  private Engine.Result run(Definition definition) {
    return engine.execute(
        "preview", null, definition, Map.of("value", new BigDecimal("42")), noReferences);
  }

  @Test
  void namedOutputWrapsTheValueAndTraceWithoutRenamingItsInput() {
    var definition = graph(output("out", "value", "total"));
    var result = run(definition);
    assertThat(result.result()).isEqualTo(Map.of("total", new BigDecimal("42")));
    assertThat(result.trace().getLast().value()).isEqualTo(result.result());
    assertThat(result.trace().getFirst().value()).isEqualTo(Map.of("value", new BigDecimal("42")));
    assertThat(validator.plan(definition, noReferences).available().get("out"))
        .contains("value")
        .doesNotContain("total");
  }

  @Test
  void unnamedOutputsKeepTheirValues() {
    for (String name : Arrays.asList(null, ""))
      assertThat(run(graph(output("out", "value", name))).result()).isEqualTo(new BigDecimal("42"));
  }

  /** An Output's result variable was once ignored; a stored graph that keeps one fails there. */
  @Test
  void anOutputThatSetsAResultVariableFailsAtThatNode() {
    var legacy =
        nodeOf("out", "OUTPUT", "out").expression("value").output("previously_ignored").build();
    assertThatThrownBy(() -> run(graph(legacy)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage())
                  .isEqualTo("Result variables belong to Formula, Transform and Reference nodes");
              assertThat(error.locations().getFirst().nodeId()).isEqualTo("out");
            });
  }

  @Test
  void explicitNullAndStructuredValuesAreWrappedWithoutFlattening() {
    var nullable = (Map<?, ?>) run(graph(output("out", "null", "total"))).result();
    assertThat(nullable).hasSize(1);
    assertThat(nullable.containsKey("total")).isTrue();
    assertThat(nullable.get("total")).isNull();
    assertThat(run(graph(output("out", "[value, 1]", "items"))).result())
        .isEqualTo(Map.of("items", List.of(new BigDecimal("42"), BigDecimal.ONE)));
    assertThat(run(graph(output("out", "$OBJECT(\"original\", value)", "total"))).result())
        .isEqualTo(Map.of("total", Map.of("original", new BigDecimal("42"))));
  }

  @Test
  void multipleNamedOutputsContributeRawValuesAtTheirEffectiveKeys() {
    var single = graph(output("first", "value", "total"));
    var definition =
        new Definition(
            1,
            single.inputs(),
            List.of(
                single.nodes().getFirst(),
                single.nodes().getLast(),
                output("second", "null", "missing"),
                output("plain", "value + 1", null)),
            List.of(
                edge("input", "first", "next"),
                edge("input", "second", "next"),
                edge("input", "plain", "next")));
    var expected = new LinkedHashMap<String, Object>();
    expected.put("total", new BigDecimal("42"));
    expected.put("plain", new BigDecimal("43"));
    expected.put("missing", null);
    assertThat(run(definition).result()).isEqualTo(expected);
  }

  @Test
  void outputNameUsesIdentifierPolicyAndBelongsOnlyToOutputNodes() {
    for (String name :
        List.of(
            "unit price",
            "price\t",
            "price\u00a0",
            "$value",
            "value$",
            "@value",
            "value@",
            "true",
            "a".repeat(65)))
      assertThatThrownBy(() -> validator.shape(graph(output("out", "value", name))))
          .isInstanceOfSatisfying(
              ArcException.class,
              failure -> {
                assertThat(failure.getMessage()).contains("valid output name");
                assertThat(failure.locations())
                    .extracting(ArcException.Location::nodeId)
                    .containsExactly("out");
              });
    for (String name : List.of("ROUND", "_total2", "a".repeat(64)))
      validator.validate(graph(output("out", "value", name)), noReferences);
    var misplaced =
        nodeOf("calc", "FORMULA", "Calc")
            .expression("1")
            .output("value")
            .outputName("total")
            .build();
    assertThatThrownBy(() -> validator.shape(graph(misplaced)))
        .hasMessage("Output names belong to Output nodes");
  }

  @Test
  void serializedGraphsAndDetachedPlansPreserveTheOptionalName() throws Exception {
    var json = new ObjectMapper();
    var definition = graph(output("out", "value", "total"));
    String encoded = json.writeValueAsString(definition);
    assertThat(encoded).contains("\"outputName\":\"total\"");
    assertThat(json.readValue(encoded, Definition.class)).isEqualTo(definition);
    assertThat(run(json.readValue(encoded, Definition.class)).result())
        .isEqualTo(Map.of("total", new BigDecimal("42")));
    var legacy = graph(output("out", "value", null));
    var oldDocument = json.valueToTree(legacy);
    oldDocument.get("nodes").forEach(node -> ((ObjectNode) node).remove("outputName"));
    String oldJson = json.writeValueAsString(oldDocument);
    assertThat(oldJson).doesNotContain("outputName");
    assertThat(run(json.readValue(oldJson, Definition.class)).result())
        .isEqualTo(new BigDecimal("42"));
  }
}
