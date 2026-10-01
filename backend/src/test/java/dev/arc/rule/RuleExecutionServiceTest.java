package dev.arc.rule;

import static dev.arc.support.GraphFixtures.calculation;
import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.SourceDefinition;
import dev.arc.rule.RuleExecutionService.*;
import dev.arc.source.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class RuleExecutionServiceTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final CountingValidator validator = new CountingValidator();
  private final ObjectMapper json = new ObjectMapper();
  private final SourceVersions versions = new SourceVersions(sources);
  private final Engine engine = new Engine(validator, json);
  private final RuleExecutionService service =
      new RuleExecutionService(
          rules,
          new RuleDefinitionService(validator, rules, new SourceBindingValidator(versions), engine),
          engine,
          new SourceExecutionService(
              sources, versions, new SourceAdapters(List.of()), new JsonPointerExtractor()));

  private static class CountingValidator extends Validator {
    int compilations;

    @Override
    public CompiledGraph compile(Definition definition, RuleResolver resolver) {
      compilations++;
      return super.compile(definition, resolver);
    }
  }

  @Test
  void executionReadsOnlyPublishedPointerAndPinAndReusesPreparedPlan() throws Exception {
    when(rules.publishedVersion("rule")).thenReturn(1);
    when(rules.resolve("rule", 1)).thenReturn(calculation());
    var first = service.execute("rule", new Execution(Map.of("amount", 100), null));
    var second = service.execute("rule", new Execution(Map.of("amount", 200), 1, false, 30_000));
    assertThat(first.execution().result()).isEqualTo(new java.math.BigDecimal("90.0"));
    assertThat(second.execution().result()).isEqualTo(new java.math.BigDecimal("180.0"));
    assertThat(validator.compilations).isEqualTo(1);
    verify(rules, never()).get(anyString());
    verify(rules, times(1)).publishedVersion("rule");
    assertThat(first.execution().traceEnabled()).isTrue();
    assertThat(first.execution().traceBytes())
        .isEqualTo(json.writeValueAsBytes(first.execution().trace()).length);
    assertThat(second.execution().trace()).isEmpty();
    assertThat(second.execution().executedSteps()).isEqualTo(3);
    assertThat(second.timing().totalMicros())
        .isGreaterThanOrEqualTo(
            second.timing().preparationMicros() + second.timing().executionMicros());
    assertThat(second.execution().durationMicros()).isEqualTo(second.timing().executionMicros());
  }

  @Test
  void anInputBeyondTheScaleRangeIsRefusedAsOutOfRange() {
    // 100E+2147483647 overflowed stripTrailingZeros() inside the input check: a 500 and an ERROR
    // stack trace instead of the documented 422.
    when(rules.resolve("rule", 1)).thenReturn(calculation());
    var huge = new java.math.BigDecimal("100E+2147483647");
    assertThatThrownBy(() -> service.execute("rule", new Execution(Map.of("amount", huge), 1)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage())
                  .contains("Number exceeds supported precision or magnitude");
            });
  }

  @Test
  void aCachedPublishedPlanIsExecutedWithoutReadingItsVersionAgain() {
    when(rules.resolve("rule", 1)).thenReturn(calculation());
    for (int amount : List.of(100, 200, 300))
      assertThat(
              service
                  .execute("rule", new Execution(Map.of("amount", amount), 1))
                  .execution()
                  .result())
          .isEqualTo(
              new java.math.BigDecimal("0.9").multiply(java.math.BigDecimal.valueOf(amount)));
    verify(rules, times(1)).resolve("rule", 1);
    assertThat(validator.compilations).isEqualTo(1);

    when(rules.resolve("rule", 9))
        .thenThrow(new ArcException(404, "Published rule version not found: rule v9"));
    for (int attempt = 0; attempt < 2; attempt++)
      assertThatThrownBy(() -> service.execute("rule", new Execution(Map.of("amount", 1), 9)))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(404);
                assertThat(error.getMessage())
                    .isEqualTo("Published rule version not found: rule v9");
              });
    verify(rules, times(2)).resolve("rule", 9);
  }

  /**
   * A published version, the pins it reaches and their source versions are immutable while it
   * lives, so its source contracts are checked once with its cached plan: every execution read each
   * reached pin again for the check, although the plans were cached.
   */
  @Test
  void aCachedPublishedPlanChecksItsSourceContractsOnce() {
    var child =
        new Definition(
            1,
            List.of(),
            List.of(inputNode("in", "Input"), outputNode("o", "O", "2")),
            List.of(new Edge("next", "in", "o", "next")));
    var parent =
        new Definition(
            1,
            List.of(),
            List.of(
                inputNode("input", "Inputs"),
                nodeOf("ref", "REFERENCE", "Ref").rule("child", 1).output("r").build(),
                outputNode("out", "Out", "r")),
            List.of(new Edge("a", "input", "ref", "next"), new Edge("b", "ref", "out", "next")));
    when(rules.resolve("parent", 1)).thenReturn(parent);
    when(rules.resolve("child", 1)).thenReturn(child);
    for (int request = 0; request < 3; request++)
      assertThat(service.execute("parent", new Execution(Map.of(), 1)).execution().result())
          .isEqualTo(java.math.BigDecimal.valueOf(2));
    verify(rules, times(1)).resolve("parent", 1);
    verify(rules, times(1)).resolve("child", 1);
    // A preview has no cached plan and is checked every time.
    service.preview(new Preview(parent, Map.of()));
    verify(rules, times(2)).resolve("child", 1);
  }

  @Test
  void changedDraftsNeverReusePublishedOrPreviousPreviewPlans() {
    var first = service.preview(new Preview(calculation(), Map.of("amount", 100)));
    var second = service.preview(new Preview(calculation(), Map.of("amount", 200)));
    assertThat(first.execution().result()).isNotEqualTo(second.execution().result());
    assertThat(validator.compilations).isEqualTo(2);
    verifyNoInteractions(rules);
  }

  @Test
  void storedDraftsAndPublishedVersionsRequireExplicitFunctionPrefixesWithoutRewritingHistory() {
    var input = inputNode("input", "Inputs");
    var edge = new Edge("next", "input", "output", "next");
    var parameters = List.of(new Input("ROUND", "NUMBER", true, null));
    var oldDefinition =
        new Definition(
            1,
            parameters,
            List.of(input, outputNode("output", "Result", "ROUND(ROUND, 2)")),
            List.of(edge));
    var updatedDefinition =
        new Definition(
            1,
            parameters,
            List.of(input, outputNode("output", "Result", "$ROUND(ROUND, 2)")),
            List.of(edge));
    when(rules.publishedVersion("old-rule")).thenReturn(1);
    when(rules.resolve("old-rule", 1)).thenReturn(oldDefinition);
    when(rules.resolve("old-rule", 2)).thenReturn(updatedDefinition);
    var inputs = Map.<String, Object>of("ROUND", new java.math.BigDecimal("1.235"));

    assertThatThrownBy(() -> service.preview(new Preview(oldDefinition, inputs)))
        .hasMessageContaining("Function calls require a $ prefix; use $ROUND(...)");
    for (Integer version : Arrays.asList(null, 1)) {
      assertThatThrownBy(() -> service.execute("old-rule", new Execution(inputs, version)))
          .isInstanceOfSatisfying(
              ArcException.class,
              failure -> {
                assertThat(failure.status()).isEqualTo(422);
                assertThat(failure.getMessage())
                    .contains("Function calls require a $ prefix; use $ROUND(...)");
                // The root location carried a null rule and version before (published pointer 1).
                assertThat(failure.locations())
                    .containsExactly(new ArcException.Location("old-rule", 1, "output", "Result"));
              });
    }
    assertThat(service.execute("old-rule", new Execution(inputs, 2)).execution().result())
        .isEqualTo(new java.math.BigDecimal("1.24"));
    assertThat(oldDefinition.nodes().getLast().expression()).isEqualTo("ROUND(ROUND, 2)");
    verify(rules).publishedVersion("old-rule");
    verify(rules, times(2)).resolve("old-rule", 1);
    verify(rules).resolve("old-rule", 2);
    verifyNoMoreInteractions(rules);
  }

  @Test
  void cachedPublishedPlansKeepConcurrentRequestInputsIsolated() throws Exception {
    when(rules.resolve("rule", 1)).thenReturn(calculation());
    service.execute("rule", new Execution(Map.of("amount", 100), 1, false, null));
    try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
      var tasks = new ArrayList<java.util.concurrent.Callable<ExecutionResponse>>();
      for (int amount = 1; amount <= 20; amount++) {
        int input = amount;
        tasks.add(
            () -> service.execute("rule", new Execution(Map.of("amount", input), 1, false, null)));
      }
      var responses = executor.invokeAll(tasks);
      for (int index = 0; index < responses.size(); index++) {
        var response = responses.get(index).get();
        assertThat(response.execution().result())
            .isEqualTo(
                java.math.BigDecimal.valueOf(index + 1L).multiply(new java.math.BigDecimal("0.9")));
        assertThat(response.execution().executedSteps()).isEqualTo(3);
        assertThat(response.execution().trace()).isEmpty();
        assertThat(response.execution().sources()).isEmpty();
      }
    }
    assertThat(validator.compilations).isEqualTo(1);
  }

  @Test
  void expiredPreparationDoesNotStartAnotherReferencedRuleQuery() throws Exception {
    Definition child =
        new Definition(
            1,
            List.of(),
            List.of(inputNode("in", "Input"), outputNode("out", "Output", "1")),
            List.of(new Edge("edge", "in", "out", "next")));
    when(rules.resolve("slow", 1))
        .thenAnswer(
            invocation -> {
              // This in-flight JDBC analogue cannot be interrupted; later reads must not start.
              Thread.sleep(150);
              return child;
            });
    Definition parent =
        new Definition(
            1,
            List.of(),
            List.of(
                child.nodes().getFirst(),
                nodeOf("first", "REFERENCE", "First")
                    .output("a")
                    .rule("slow", 1)
                    .bindings(Map.of())
                    .build(),
                nodeOf("second", "REFERENCE", "Second")
                    .output("b")
                    .rule("later", 1)
                    .bindings(Map.of())
                    .build(),
                child.nodes().getLast()),
            List.of(
                new Edge("one", "in", "first", "next"),
                new Edge("two", "first", "second", "next"),
                new Edge("three", "second", "out", "next")));
    assertThatThrownBy(() -> service.preview(new Preview(parent, Map.of(), false, 100)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
    verify(rules).resolve("slow", 1);
    verify(rules, never()).resolve("later", 1);
  }

  @Test
  void aPublishedCallerCannotRecoverACalleeVersionThatNoLongerPrepares() {
    var amount = List.of(new Input("amount", "NUMBER", true, null));
    var edge = new Edge("next", "input", "output", "next");
    // Stored before unused properties were rejected: an Output with a result variable.
    var child =
        new Definition(
            1,
            amount,
            List.of(
                inputNode("input", "Inputs"),
                nodeOf("output", "OUTPUT", "Result").expression("amount * 2").output("r").build()),
            List.of(edge));
    var parent =
        new Definition(
            1,
            amount,
            List.of(
                inputNode("input", "Inputs"),
                outputNode("output", "Result", "$IFERROR(@child:1(amount), -1)")),
            List.of(edge));
    when(rules.publishedVersion("parent")).thenReturn(1);
    when(rules.resolve("parent", 1)).thenReturn(parent);
    when(rules.resolveFormula("child", 1)).thenReturn(child);
    // This returned 200 with -1 before: the fallback hid the callee's broken definition.
    assertThatThrownBy(() -> service.execute("parent", new Execution(Map.of("amount", 3), null)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage())
                  .isEqualTo("Result variables belong to Formula, Transform and Reference nodes");
              assertThat(error.locations())
                  .contains(new ArcException.Location("child", 1, "output", "Result"));
            });
  }

  @Test
  void legacyUnpublishedAndInvalidTimeoutErrorsRemainExplicit() {
    when(rules.publishedVersion("draft")).thenReturn(null);
    assertThatThrownBy(() -> service.execute("draft", new Execution(Map.of(), null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(409));
    assertThatThrownBy(() -> service.execute("draft", new Execution(Map.of(), null, true, 99)))
        .hasMessageContaining("100–30,000");
  }

  @Test
  void aPublishedExecutionNamesItsVersionInSourceContractFailures() {
    var remote =
        new SourceDefinition(
            "HTTP",
            "https://example.test/data",
            List.of(new Input("key", "STRING", true, null)),
            null,
            null,
            500);
    when(sources.get("remote", 1)).thenReturn(new DataSource("remote", "Remote", 1, remote));
    var child =
        new Definition(
            1,
            List.of(
                new Input(
                    "value",
                    "NUMBER",
                    true,
                    null,
                    new SourceBinding("remote", 1, Map.of(), "", "FAIL"))),
            List.of(inputNode("in", "Input"), outputNode("o", "O", "value")),
            List.of(new Edge("next", "in", "o", "next")));
    var parent =
        new Definition(
            1,
            List.of(),
            List.of(
                inputNode("input", "Inputs"),
                nodeOf("ref", "REFERENCE", "Ref").rule("child", 1).output("r").build(),
                outputNode("out", "Out", "r")),
            List.of(new Edge("a", "input", "ref", "next"), new Edge("b", "ref", "out", "next")));
    when(rules.publishedVersion("parent")).thenReturn(1);
    when(rules.resolve("parent", 1)).thenReturn(parent);
    when(rules.resolve("child", 1)).thenReturn(child);
    // The walk's root location was (null, null, ref) before; a preview keeps that form.
    assertThatThrownBy(() -> service.execute("parent", new Execution(Map.of(), null)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error ->
                assertThat(error.locations())
                    .last()
                    .isEqualTo(new ArcException.Location("parent", 1, "ref", "Ref")));
    assertThatThrownBy(() -> service.preview(new Preview(parent, Map.of())))
        .isInstanceOfSatisfying(
            ArcException.class,
            error ->
                assertThat(error.locations())
                    .last()
                    .isEqualTo(new ArcException.Location(null, null, "ref", "Ref")));
  }
}
