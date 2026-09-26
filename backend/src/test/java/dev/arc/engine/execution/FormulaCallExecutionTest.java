package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.SourceReader;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class FormulaCallExecutionTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Engine engine = new Engine(validator);

  private Definition graph(List<Input> inputs, String expression) {
    return new Definition(
        1,
        inputs,
        List.of(
            new Node("in", "INPUT", "Input", null, null, null, null, null, null),
            new Node("out", "OUTPUT", "Output", null, expression, null, null, null, null)),
        List.of(new Edge("next", "in", "out", "next")));
  }

  private RuleResolver formulas(Map<String, Definition> definitions) {
    return new RuleResolver() {
      @Override
      public Definition resolve(String id, int version) {
        var definition = definitions.get(id + ":" + version);
        if (definition == null) throw new ArcException(404, "Missing published Formula");
        return definition;
      }

      @Override
      public Definition resolveFormula(String id, int version) {
        return resolve(id, version);
      }
    };
  }

  private Engine.Result run(Definition graph, RuleResolver resolver) {
    return engine.execute("parent", 1, graph, Map.of(), resolver);
  }

  @Test
  void positionalCallsHonorPublishedPinsDefaultsAndExplicitNullAndShareTrace() {
    var inputs =
        List.of(new Input("amount", "NUMBER", true, null), new Input("extra", "NUMBER", false, 10));
    var resolver =
        formulas(
            Map.of(
                "price:1", graph(inputs, "amount + $COALESCE(extra, 0)"),
                "price:2", graph(inputs, "amount * 2")));
    var parent = graph(List.of(), "$SUM(@price:1(2), @price:1(2, null), @price:2(2))");
    var result = run(parent, resolver);
    assertThat(result.result()).isEqualTo(new BigDecimal("18"));
    assertThat(result.executedSteps()).isEqualTo(8);
    assertThat(result.trace())
        .filteredOn(step -> step.ruleId().equals("price"))
        .extracting(Engine.Step::version)
        .containsExactly(1, 1, 1, 1, 2, 2);
    assertThat(result.trace())
        .filteredOn(step -> step.ruleId().equals("price"))
        .allMatch(step -> step.depth() == 1);
    assertThatThrownBy(() -> run(graph(List.of(), "@price:1()"), resolver))
        .hasMessageContaining("needs argument 1 (amount)");
    assertThatThrownBy(() -> run(graph(List.of(), "@price:1(1, 2, 3)"), resolver))
        .hasMessageContaining("at most 2 arguments");
    assertThatThrownBy(() -> run(graph(List.of(), "@price:1(null)"), resolver))
        .hasMessageContaining("Missing required input: amount");
  }

  @Test
  void callsWorkInEveryGraphExpressionSiteAndInsideCollectionLocals() {
    var number = List.of(new Input("value", "NUMBER", true, null));
    var resolver =
        formulas(
            Map.of(
                "increment:1",
                graph(number, "value + 1"),
                "positive:1",
                graph(number, "value > 0"),
                "echo:1",
                graph(number, "value")));
    var parent =
        script.parse(
            """
        inputs { amount: NUMBER required default 2; }
        node in INPUT "Input" { next -> transform; }
        node transform TRANSFORM "Transform" {
          field "value" = @increment:1(amount);
          as data;
          next -> calculate;
        }
        node calculate FORMULA "Calculate" { let total = @increment:1(data.value); next -> condition; }
        node condition CONDITION "Condition" { when @positive:1(total); true -> choose; false -> out; }
        node choose SWITCH "Choose" {
          select @echo:1(total);
          case "hit" "Hit" equals @increment:1(3);
          case:hit -> reference;
          default -> out;
        }
        node reference REFERENCE "Reference" { use "echo" version 1; bind value = @increment:1(total); as reused; next -> out; }
        node out OUTPUT "Out" { return $SUM($MAP([1, 2], item, @increment:1(item))); }
        """);
    assertThat(run(parent, resolver).result()).isEqualTo(new BigDecimal("5"));
    assertThat(script.build(script.render(parent)).definition()).isEqualTo(parent);
    var booleanSwitch =
        script.parse(
            """
        node in INPUT "Input" { next -> choose; }
        node choose SWITCH "Choose" { case "hit" "Hit" when @positive:1(1); case:hit -> out; default -> out; }
        node out OUTPUT "Out" { return 7; }
        """);
    assertThat(run(booleanSwitch, resolver).result()).isEqualTo(new BigDecimal("7"));
    var expressionTransform =
        script.parse(
            """
        node in INPUT "Input" { next -> transform; }
        node transform TRANSFORM "Transform" { let total = @increment:1(2); next -> out; }
        node out OUTPUT "Out" { return total; }
        """);
    assertThat(run(expressionTransform, resolver).result()).isEqualTo(new BigDecimal("3"));
  }

  @Test
  void sourceBindingsCanCallFormulasAndInactiveCallsFetchNoValues() {
    var increment = graph(List.of(new Input("value", "NUMBER", true, null)), "value + 1");
    var sourced =
        new Input(
            "value",
            "NUMBER",
            true,
            null,
            new SourceBinding("table", 1, Map.of("key", "@increment:1(2)"), "", "FAIL"));
    var resolver =
        formulas(Map.of("sourced:1", graph(List.of(sourced), "value"), "increment:1", increment));
    var fetches = new AtomicInteger();
    SourceReader reader =
        (binding, inputs) -> {
          fetches.incrementAndGet();
          assertThat(inputs).containsEntry("key", new BigDecimal("3"));
          return 8;
        };
    var parent = graph(List.of(), "$IF(false, @sourced:1(), 0) + @sourced:1()");
    var result = engine.execute("parent", 1, parent, Map.of(), resolver, new Parameters(reader));
    assertThat(result.result()).isEqualTo(new BigDecimal("8"));
    assertThat(fetches).hasValue(1);
    assertThat(result.sources()).hasSize(1);
    assertThat(result.trace())
        .filteredOn(step -> step.ruleId().equals("increment"))
        .allMatch(step -> step.depth() == 2);
    assertThat(result.executedSteps()).isEqualTo(6);
  }

  @Test
  void formulaCallsShareSourceStepAndRecursionBudgets() {
    var source =
        new Input(
            "value", "NUMBER", true, null, new SourceBinding("table", 1, Map.of(), "", "FAIL"));
    var resolver =
        formulas(
            Map.of(
                "read:1",
                graph(List.of(source), "value"),
                "one:1",
                graph(List.of(), "1"),
                "recursive:1",
                graph(List.of(), "@recursive:1()")));
    assertThatThrownBy(
            () ->
                engine.execute(
                    "parent",
                    1,
                    graph(
                        List.of(new Input("items", "ARRAY", true, Collections.nCopies(51, 1))),
                        "$MAP(items, item, @read:1())"),
                    Map.of(),
                    resolver,
                    new Parameters((binding, inputs) -> 1)))
        .hasMessageContaining("50 source reads");
    assertThatThrownBy(
            () ->
                run(
                    graph(
                        List.of(new Input("items", "ARRAY", true, Collections.nCopies(500, 1))),
                        "$MAP(items, item, @one:1())"),
                    resolver))
        .hasMessageContaining("1,000 steps");
    assertThatThrownBy(() -> run(graph(List.of(), "@recursive:1()"), resolver))
        .hasMessageContaining("Circular rule reference");
    var nested = new HashMap<String, Definition>();
    for (int index = 0; index < 18; index++)
      nested.put(
          "level-" + index + ":1",
          graph(List.of(), index == 17 ? "1" : "@level-" + (index + 1) + ":1()"));
    assertThatThrownBy(() -> run(graph(List.of(), "@level-0:1()"), formulas(nested)))
        .hasMessageContaining("16 levels");
  }

  @Test
  void nestedErrorsKeepChildAndCallerLocationsAcrossTransformAndSwitchContexts() {
    var resolver = formulas(Map.of("broken:1", graph(List.of(), "1/0")));
    for (String body :
        List.of(
            "node action TRANSFORM \"Action\" { field \"cost\" = @broken:1(); as data; next -> out; }",
            "node action SWITCH \"Action\" { select @broken:1(); case \"one\" \"One\" equals 1; case:one -> out; default -> out; }",
            "node action SWITCH \"Action\" { case \"one\" \"One\" when @broken:1(); case:one -> out; default -> out; }")) {
      var parent =
          script.parse(
              "node in INPUT \"Input\" { next -> action; } "
                  + body
                  + " node out OUTPUT \"Output\" { return 1; }");
      assertThatThrownBy(() -> run(parent, resolver))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.locations())
                    .containsExactly(
                        new ArcException.Location("broken", 1, "out", "Output"),
                        new ArcException.Location("parent", 1, "action", "Action"));
                assertThat(error.getMessage()).contains("Division by zero");
              });
    }
  }

  @Test
  void aChildDeadlineCannotBeHiddenByIferror() {
    var deadline = ExecutionDeadline.start(100);
    var child =
        graph(
            List.of(
                new Input(
                    "value",
                    "NUMBER",
                    true,
                    null,
                    new SourceBinding("slow", 1, Map.of(), "", "FAIL"))),
            "value");
    SourceReader slow =
        (binding, inputs) -> {
          java.util.concurrent.locks.LockSupport.parkNanos(120_000_000);
          return 1;
        };
    var parent = graph(List.of(), "$IFERROR(@slow:1(), 9)");
    assertThatThrownBy(
            () ->
                engine
                    .session(formulas(Map.of("slow:1", child)), deadline)
                    .execute("parent", 1, parent, Map.of(), new Parameters(slow), true))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
  }
}
