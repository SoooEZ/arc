package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

/** Expression fallbacks recover value errors, never the budgets shared by nested Formula calls. */
class ErrorRecoveryTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Engine engine = new Engine(validator);
  private final RuleResolver formulas = formulas(publishedFormulas());

  private static Definition graph(List<Input> inputs, String expression) {
    return new Definition(
        1,
        inputs,
        List.of(inputNode("in", "Input"), outputNode("out", "Output", expression)),
        List.of(new Edge("next", "in", "out", "next")));
  }

  /** The guarded expression is not the last node, so later work also observes the budget. */
  private static Definition formulaThenOutput(List<Input> inputs, String expression) {
    return new Definition(
        1,
        inputs,
        List.of(
            inputNode("in", "Input"),
            nodeOf("calc", "FORMULA", "Calc").expression(expression).output("total").build(),
            outputNode("out", "Output", "total")),
        List.of(new Edge("a", "in", "calc", "next"), new Edge("b", "calc", "out", "next")));
  }

  private static List<Input> items(int count) {
    return List.of(new Input("items", "ARRAY", true, Collections.nCopies(count, 1)));
  }

  private static Map<String, Definition> publishedFormulas() {
    var sourced =
        new Input(
            "value", "NUMBER", true, null, new SourceBinding("table", 1, Map.of(), "", "FAIL"));
    var definitions = new HashMap<String, Definition>();
    definitions.put("one:1", graph(List.of(), "1"));
    definitions.put("read:1", graph(List.of(sourced), "value"));
    definitions.put("broken:1", graph(List.of(), "1 / 0"));
    definitions.put("lookup:1", graph(List.of(), "$MATCH(\"zz\", [\"a\"], 0)"));
    var amount = List.of(new Input("amount", "NUMBER", true, null));
    // Stored versions that no longer prepare: an Output with a result variable (lesson B25) and an
    // unprefixed function call.
    definitions.put(
        "stale:1",
        new Definition(
            1,
            amount,
            List.of(
                inputNode("in", "Input"),
                nodeOf("out", "OUTPUT", "Output").expression("amount").output("r").build()),
            List.of(new Edge("next", "in", "out", "next"))));
    definitions.put("unprefixed:1", graph(amount, "ROUND(amount, 2)"));
    definitions.put("echo:1", graph(amount, "amount"));
    // level-0 calls level-1 ... level-17, one level deeper than the shared nesting limit allows.
    for (int level = 0; level < 18; level++)
      definitions.put(
          "level-" + level + ":1",
          graph(List.of(), level == 17 ? "1" : "@level-" + (level + 1) + ":1()"));
    return definitions;
  }

  private static RuleResolver formulas(Map<String, Definition> definitions) {
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

  private Engine.Result run(Definition parent) {
    return engine.execute("parent", 1, parent, Map.of(), formulas);
  }

  private static void assertLimit(ThrowingCallable execution, String message) {
    assertThatThrownBy(execution)
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
              assertThat(error.getMessage()).isEqualTo(message);
            });
  }

  @Test
  void errorFunctionsCannotHideAnExhaustedStepBudget() {
    // Each call uses two of the 1,000 shared steps; 600 calls exhaust them part-way through.
    for (String expression :
        List.of(
            "$SUM($MAP(items, x, $IFERROR(@one:1(), 0)))",
            "$IFERROR($SUM($MAP(items, x, @one:1())), -1)",
            "$SUM($MAP(items, x, $IF($ISERROR(@one:1()), 1, 0)))",
            "$SUM($MAP(items, x, $IF($ISERR(@one:1()), 1, 0)))",
            "$SUM($MAP(items, x, $IF($ISNA(@one:1()), 1, 0)))")) {
      assertLimit(() -> run(graph(items(600), expression)), "Execution exceeds 1,000 steps");
    }
  }

  @Test
  void errorFunctionsCannotHideAnExhaustedSourceReadBudget() {
    for (Definition parent :
        List.of(
            graph(items(60), "$SUM($MAP(items, x, $IFERROR(@read:1(), 0)))"),
            graph(items(60), "$IFERROR($SUM($MAP(items, x, @read:1())), -1)"),
            formulaThenOutput(items(60), "$SUM($MAP(items, x, $IFERROR(@read:1(), 0)))"))) {
      var providerReads = new AtomicInteger();
      SourceReader reader =
          (binding, inputs, deadline) -> {
            providerReads.incrementAndGet();
            return 1;
          };
      assertLimit(
          () -> engine.execute("parent", 1, parent, Map.of(), formulas, new Parameters(reader)),
          "Execution exceeds 50 source reads");
      assertThat(providerReads).hasValue(50);
    }
  }

  @Test
  void errorFunctionsCannotHideTheNestingLimit() {
    for (String expression :
        List.of("$IFERROR(@level-0:1(), -1)", "$ISERROR(@level-0:1())", "$ISERR(@level-0:1())")) {
      assertLimit(() -> run(graph(List.of(), expression)), "Rule nesting exceeds 16 levels");
    }
    // level-2 ... level-17 is exactly 16 nested calls below the parent.
    assertThat(run(graph(List.of(), "@level-2:1()")).result()).isEqualTo(BigDecimal.ONE);
  }

  @Test
  void limitsKeepTheirMessageWhileValueErrorsNameTheirFieldOrCase() {
    var sites = new LinkedHashMap<String, String>();
    sites.put(
        "Field cost",
        "node action TRANSFORM \"Action\" { field \"cost\" = @%s:1(); as data; next -> out; }");
    sites.put(
        "Selector",
        "node action SWITCH \"Action\" { select @%s:1(); case \"one\" \"One\" equals 1;"
            + " case:one -> out; default -> out; }");
    sites.put(
        "Case One",
        "node action SWITCH \"Action\" { case \"one\" \"One\" when @%s:1();"
            + " case:one -> out; default -> out; }");
    for (var site : sites.entrySet()) {
      assertThatThrownBy(() -> run(callFrom(site.getValue(), "broken")))
          .as(site.getKey())
          .hasMessage(site.getKey() + ": Division by zero");
      assertThatThrownBy(() -> run(callFrom(site.getValue(), "level-0")))
          .as(site.getKey())
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo("Rule nesting exceeds 16 levels");
                assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
                assertThat(error.locations())
                    .last()
                    .isEqualTo(new ArcException.Location("parent", 1, "action", "Action"));
              });
    }
  }

  private Definition callFrom(String actionTemplate, String child) {
    return script.parse(
        "node in INPUT \"Input\" { next -> action; } "
            + actionTemplate.formatted(child)
            + " node out OUTPUT \"Output\" { return 1; }");
  }

  @Test
  void notAvailableSurvivesNestedCallsAndStaysRecoverable() {
    assertThat(run(graph(List.of(), "$ISNA(@lookup:1())")).result()).isEqualTo(true);
    assertThat(run(graph(List.of(), "$ISERR(@lookup:1())")).result()).isEqualTo(false);
    assertThat(run(graph(List.of(), "$IFERROR(@lookup:1(), \"none\")")).result()).isEqualTo("none");
    assertThat(run(graph(List.of(), "$ISNA(@broken:1())")).result()).isEqualTo(false);
    assertThat(run(graph(List.of(), "$ISERR(@broken:1())")).result()).isEqualTo(true);
  }

  @Test
  void errorFunctionsCannotHideACalledVersionThatCannotBePrepared() {
    // $IFERROR answered -1 and the $IS… functions true for these calls before, so a published
    // caller changed its result silently once the callee's stored definition stopped preparing.
    for (String expression :
        List.of(
            "$IFERROR(@stale:1(3), -1)",
            "$ISERROR(@stale:1(3))",
            "$ISERR(@stale:1(3))",
            "$ISNA(@stale:1(3))")) {
      assertThatThrownBy(() -> run(graph(List.of(), expression)))
          .as(expression)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.kind()).isEqualTo(ArcException.Kind.DEFINITION);
                assertThat(error.getMessage())
                    .isEqualTo("Result variables belong to Formula, Transform and Reference nodes");
                assertThat(error.locations())
                    .containsExactly(
                        new ArcException.Location("stale", 1, "out", "Output"),
                        new ArcException.Location("parent", 1, "out", "Output"));
              });
    }
    assertThatThrownBy(() -> run(graph(List.of(), "$IFERROR(@unprefixed:1(3), -1)")))
        .hasMessageContaining("Function calls require a $ prefix; use $ROUND(...)");
    assertThatThrownBy(() -> run(graph(List.of(), "$IFERROR(@missing:1(), -1)")))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(404);
              assertThat(error.kind()).isEqualTo(ArcException.Kind.DEFINITION);
            });
    // The callee's own value errors stay recoverable.
    assertThat(run(graph(List.of(), "$IFERROR(@broken:1(), -1)")).result())
        .isEqualTo(new BigDecimal("-1"));
  }

  @Test
  void bindingFailuresNameTheBindingWhileLimitsKeepTheirMessage() {
    // A failed binding surfaced as the bare "Division by zero" at the Reference node.
    var parent =
        script.parse(
            "inputs { zero: NUMBER required; }\n"
                + "node in INPUT \"Input\" { next -> reuse; }\n"
                + "node reuse REFERENCE \"Reuse\" { use \"echo\" version 1; bind amount = 1 / zero;"
                + " as r; next -> out; }\n"
                + "node out OUTPUT \"Output\" { return r; }");
    assertThatThrownBy(() -> engine.execute("parent", 1, parent, Map.of("zero", 0), formulas))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo("amount: Division by zero");
              assertThat(error.locations())
                  .last()
                  .isEqualTo(new ArcException.Location("parent", 1, "reuse", "Reuse"));
            });
    var nested =
        script.parse(
            "node in INPUT \"Input\" { next -> reuse; }\n"
                + "node reuse REFERENCE \"Reuse\" { use \"echo\" version 1;"
                + " bind amount = @level-0:1(); as r; next -> out; }\n"
                + "node out OUTPUT \"Output\" { return r; }");
    assertLimit(
        () -> engine.execute("parent", 1, nested, Map.of(), formulas),
        "Rule nesting exceeds 16 levels");
  }
}
