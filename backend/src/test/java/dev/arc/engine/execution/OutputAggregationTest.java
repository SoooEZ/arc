package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class OutputAggregationTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Engine engine = new Engine(validator);
  private final RuleResolver noReferences =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  private Engine.Result run(Definition definition) {
    return engine.execute("test", 1, definition, Map.of(), noReferences);
  }

  @Test
  void multipleOutputsPreferNamesThenDirectVariablesAndOtherwiseNodeIds() {
    var definition =
        script.parse(
            """
        inputs { amount: NUMBER required default 42; customer: OBJECT required default {"amount": 7}; }
        node input INPUT "Input" { next -> a; next -> b; next -> c; next -> d; next -> e; next -> f; next -> g; }
        node a OUTPUT "Variable" { return amount; }
        node b OUTPUT "Alias" { return amount; as payable; }
        node c OUTPUT "Property" { return customer.amount; }
        node d OUTPUT "Arithmetic" { return amount + 1; }
        node e OUTPUT "Constant" { return true; }
        node f OUTPUT "Parenthesized" { return (amount); }
        node g OUTPUT "Function" { return $ROUND(amount, 0); }
        """);
    var nodes = new ArrayList<>(definition.nodes());
    var direct = nodes.get(1);
    nodes.set(
        1,
        new Definition.Node(
            direct.id(),
            direct.type(),
            direct.label(),
            direct.position(),
            "  amount\t",
            direct.output(),
            null,
            null,
            null,
            null,
            null,
            null,
            ""));
    definition =
        new Definition(1, definition.inputs(), nodes, definition.edges(), definition.notes());
    var result = run(definition);
    assertThat(result.result())
        .isEqualTo(
            Map.of(
                "amount",
                new BigDecimal("42"),
                "payable",
                new BigDecimal("42"),
                "c",
                7,
                "d",
                new BigDecimal("43"),
                "e",
                true,
                "f",
                new BigDecimal("42"),
                "g",
                new BigDecimal("42")));
    assertThat(new ArrayList<Object>(((Map<?, ?>) result.result()).keySet()))
        .containsExactly("amount", "payable", "c", "d", "e", "f", "g");
    assertThat(result.trace())
        .filteredOn(step -> step.nodeId().equals("b"))
        .extracting(Engine.Step::value)
        .containsExactly(Map.of("payable", new BigDecimal("42")));
    Collections.reverse(nodes);
    var edges = new ArrayList<>(definition.edges());
    Collections.reverse(edges);
    var reversed = run(new Definition(1, definition.inputs(), nodes, edges, definition.notes()));
    assertThat(reversed)
        .usingRecursiveComparison()
        .ignoringFields("durationMicros")
        .isEqualTo(result);
    assertThat(new ArrayList<>(((Map<?, ?>) reversed.result()).keySet()))
        .isEqualTo(new ArrayList<>(((Map<?, ?>) result.result()).keySet()));
  }

  @Test
  void aggregateFieldsKeepExplicitNullArraysAndObjectsWithoutFlattening() {
    var definition =
        script.parse(
            """
        node input INPUT "Input" { next -> a; next -> b; next -> c; }
        node a OUTPUT "Nullable" { return null; as missing; }
        node b OUTPUT "Array" { return [1, null]; as items; }
        node c OUTPUT "Object" { return $OBJECT("name", "Ada"); as customer; }
        """);
    var expected = new LinkedHashMap<String, Object>();
    expected.put("missing", null);
    expected.put("items", Arrays.asList(BigDecimal.ONE, null));
    expected.put("customer", Map.of("name", "Ada"));
    var result = run(definition);
    assertThat(result.result()).isEqualTo(expected);
    assertThat(result.trace())
        .filteredOn(step -> step.nodeId().equals("a"))
        .extracting(Engine.Step::value)
        .containsExactly(Collections.singletonMap("missing", null));
    assertThat(script.build(script.render(definition)).definition()).isEqualTo(definition);
  }

  @Test
  void duplicateReachedKeysFailForNullsAliasesVariablesAndFallbackIds() {
    for (String[] declarations :
        List.of(
            new String[] {"return null; as amount;", "return 2; as amount;"},
            new String[] {"return null; as amount;", "return amount;"},
            new String[] {"return amount;", "return amount;"},
            new String[] {"return null; as b;", "return 2;"})) {
      var definition =
          script.parse(
              "inputs { amount: NUMBER required default 42; } node input INPUT \"Input\" { next -> a; next -> b; } node a OUTPUT \"First\" { "
                  + declarations[0]
                  + " } node b OUTPUT \"Second\" { "
                  + declarations[1]
                  + " }");
      validator.validate(definition, noReferences);
      assertThatThrownBy(() -> run(definition))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage())
                    .contains("Duplicate output field", "distinct Output names");
                assertThat(error.locations())
                    .containsExactly(
                        new ArcException.Location("test", 1, "a", "First"),
                        new ArcException.Location("test", 1, "b", "Second"));
              });
    }
  }

  @Test
  void mutuallyExclusiveOutputsCanShareANameAndOneReachedOutputKeepsItsWrapper() {
    var definition =
        script.parse(
            """
        inputs { enabled: BOOLEAN required; }
        node input INPUT "Input" { next -> condition; }
        node condition CONDITION "Condition" { when enabled; true -> yes; false -> no; }
        node yes OUTPUT "Yes" { return 42; as total; }
        node no OUTPUT "No" { return null; as total; }
        """);
    validator.validate(definition, noReferences);
    assertThat(
            engine.execute("test", 1, definition, Map.of("enabled", true), noReferences).result())
        .isEqualTo(Map.of("total", new BigDecimal("42")));
    var result = engine.execute("test", 1, definition, Map.of("enabled", false), noReferences);
    assertThat(result.result()).isEqualTo(Collections.singletonMap("total", null));
    assertThat(result.trace())
        .extracting(Engine.Step::nodeId)
        .containsExactly("input", "condition", "no");
  }

  @Test
  void multiOutputValuesDoNotPayForAnUnusedAliasWrapperButSingleOutputBoundsRemainLocated() {
    String value = "1";
    for (int depth = 0; depth < 8; depth++) value = "[" + value + "]";
    String body = "node deep OUTPUT \"Deep\" { return " + value + "; as nested; }";
    var multiple =
        script.parse(
            "node input INPUT \"Input\" { next -> deep; next -> other; } "
                + body
                + " node other OUTPUT \"Other\" { return null; }");
    var result = run(multiple);
    assertThat(new ArrayList<Object>(((Map<?, ?>) result.result()).keySet()))
        .containsExactly("nested", "other");
    assertThat(result.trace())
        .filteredOn(step -> step.nodeId().equals("deep"))
        .extracting(Engine.Step::value)
        .containsExactly(
            Collections.singletonMap("nested", ((Map<?, ?>) result.result()).get("nested")));
    var single = script.parse("node input INPUT \"Input\" { next -> deep; } " + body);
    assertThatThrownBy(() -> run(single))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).contains("collection depth or size limit");
              assertThat(error.locations())
                  .containsExactly(new ArcException.Location("test", 1, "deep", "Deep"));
            });
    var unbounded =
        script.parse(
            "node input INPUT \"Input\" { next -> deep; next -> other; } "
                + body.replace(value, "[" + value + "]")
                + " node other OUTPUT \"Other\" { return null; }");
    assertThatThrownBy(() -> run(unbounded)).hasMessageContaining("collection depth or size limit");
  }
}
