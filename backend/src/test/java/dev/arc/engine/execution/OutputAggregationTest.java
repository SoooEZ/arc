package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.copyOf;
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
    nodes.set(1, copyOf(direct).expression(" amount\t").outputName("").build());
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

  /**
   * A Reference stores its callee's aggregate as returned (lesson B19). An unnamed Output that
   * returns such a value, whole or through a lazy function or a Formula call, is bounded where its
   * expression is evaluated, so the result needs no second walk.
   */
  @Test
  void anUnnamedOutputStillBoundsAnAggregateItPassesThrough() {
    var child = new StringBuilder("inputs { items: ARRAY required; } node input INPUT \"Input\" {");
    for (int field = 0; field <= 10; field++) child.append(" next -> o").append(field).append(';');
    child.append(" }");
    for (int field = 0; field <= 10; field++)
      child.append(
          " node o%d OUTPUT \"O%d\" { return items; as f%d; }".formatted(field, field, field));
    var callee = script.parse(child.toString());
    var children =
        new RuleResolver() {
          @Override
          public Definition resolve(String id, int version) {
            return callee;
          }

          @Override
          public Definition resolveFormula(String id, int version) {
            return callee;
          }
        };
    var items = new ArrayList<Object>();
    for (int index = 0; index < 1000; index++)
      items.add(Map.of("n", BigDecimal.valueOf(index), "name", "item", "price", BigDecimal.TEN));
    for (String root : List.of("bundle", "$IF(true, bundle, null)", "@child:1(items)")) {
      var parent =
          script.parse(
              "inputs { items: ARRAY required; }"
                  + " node input INPUT \"Input\" { next -> bundle; }"
                  + " node bundle REFERENCE \"Bundle\" { use \"child\" version 1;"
                  + " bind items = items; as bundle; next -> out; }"
                  + " node out OUTPUT \"Out\" { return "
                  + root
                  + "; }");
      assertThatThrownBy(
              () -> engine.execute("parent", 1, parent, Map.of("items", items), children))
          .as(root)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).contains("collection depth or size limit");
                assertThat(error.locations())
                    .containsExactly(new ArcException.Location("parent", 1, "out", "Out"));
              });
    }
  }

  /**
   * Each Output's value keeps its own bounds, and the aggregate has a budget as a whole (elements
   * and characters of text, {@code Limits.MAX_RESULT_*}): 99 Outputs of a bounded value could
   * stream gigabytes, and a parent holding such values from nine References exhausted the heap. The
   * budget is a limit, located at the Output that passes it, that no fallback hides, and both
   * callers of the rule see it alike (lesson B19).
   */
  @Test
  void aMultiOutputAggregateHasABudgetAsAWholeAtTheOutputThatPassesIt() {
    // 15 Outputs (o00 to o14, reached in that order) of 1,000 objects with three fields:
    // 7,001 elements each, 105,031 in all, so the fifteenth passes the budget.
    var items = new ArrayList<Object>();
    for (int index = 0; index < 1000; index++)
      items.add(Map.of("n", BigDecimal.valueOf(index), "name", "item", "price", BigDecimal.TEN));
    var tooMany = outputsReturning(15, "items");
    var fourteen = outputsReturning(14, "items");
    assertThatCode(() -> engine.execute("child", 1, fourteen, Map.of("items", items), noReferences))
        .doesNotThrowAnyException();
    String elements = "Result exceeds 100,000 elements across its Outputs";
    assertThatThrownBy(
            () -> engine.execute("child", 1, tooMany, Map.of("items", items), noReferences))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo(elements);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
              assertThat(error.locations())
                  .containsExactly(new ArcException.Location("child", 1, "o14", "O14"));
            });
    var children = resolving(tooMany);
    for (String call : List.of("bundle", "$IFERROR(@child:1(items), -1)")) {
      var parent =
          script.parse(
              "inputs { items: ARRAY required; }"
                  + " node input INPUT \"Input\" { next -> bundle; }"
                  + " node bundle REFERENCE \"Bundle\" { use \"child\" version 1;"
                  + " bind items = items; as bundle; next -> out; }"
                  + " node out OUTPUT \"Out\" { return "
                  + call
                  + "; }");
      assertThatThrownBy(
              () -> engine.execute("parent", 1, parent, Map.of("items", items), children))
          .as(call)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo(elements);
                assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
                assertThat(error.locations())
                    .extracting(ArcException.Location::nodeId)
                    .contains("o14");
              });
    }
    // Text counts across the Outputs too: two Outputs of 1,000 texts of 1,000 characters.
    var text = "t".repeat(1000);
    var texts = outputsReturning(2, "$MAP(items, item, text)");
    var oneText = outputsReturning(1, "$MAP(items, item, text)");
    var inputs = Map.<String, Object>of("items", items, "text", text);
    assertThatCode(() -> engine.execute("child", 1, oneText, inputs, noReferences))
        .doesNotThrowAnyException();
    assertThatThrownBy(() -> engine.execute("child", 1, texts, inputs, noReferences))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage())
                  .isEqualTo("Result exceeds 2,000,000 characters of text across its Outputs");
              assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
              assertThat(error.locations())
                  .containsExactly(new ArcException.Location("child", 1, "o01", "O01"));
            });
  }

  /** A rule whose Input fans out to {@code count} Outputs, each returning {@code expression}. */
  private Definition outputsReturning(int count, String expression) {
    var source =
        new StringBuilder(
            "inputs { items: ARRAY required; text: STRING optional; }"
                + " node input INPUT \"Input\" {");
    for (int field = 0; field < count; field++) source.append(" next -> o%02d;".formatted(field));
    source.append(" }");
    for (int field = 0; field < count; field++)
      source.append(
          " node o%02d OUTPUT \"O%02d\" { return %s; as f%d; }"
              .formatted(field, field, expression, field));
    return script.parse(source.toString());
  }

  private static RuleResolver resolving(Definition child) {
    return new RuleResolver() {
      @Override
      public Definition resolve(String id, int version) {
        return child;
      }

      @Override
      public Definition resolveFormula(String id, int version) {
        return child;
      }
    };
  }
}
