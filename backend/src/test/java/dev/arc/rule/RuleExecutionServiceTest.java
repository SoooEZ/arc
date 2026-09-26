package dev.arc.rule;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleExecutionService.*;
import dev.arc.source.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class RuleExecutionServiceTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final CountingValidator validator = new CountingValidator();
  private final ObjectMapper json = new ObjectMapper();
  private final RuleExecutionService service =
      new RuleExecutionService(
          rules,
          new RuleDefinitionService(validator, rules, new SourceBindingValidator(sources)),
          new Engine(validator, json),
          new SourceExecutionService(
              sources, new SourceAdapters(List.of()), new JsonPointerExtractor(json)));

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
    when(rules.resolve("rule", 1)).thenReturn(RuleSamples.blank("FORMULA"));
    var first = service.execute("rule", new Execution(Map.of("amount", 100), null));
    var second = service.execute("rule", new Execution(Map.of("amount", 200), 1, false, 30_000));
    assertThat(first.result()).isEqualTo(new java.math.BigDecimal("90.0"));
    assertThat(second.result()).isEqualTo(new java.math.BigDecimal("180.0"));
    assertThat(validator.compilations).isEqualTo(1);
    verify(rules, never()).get(anyString());
    verify(rules, times(1)).publishedVersion("rule");
    assertThat(first.traceEnabled()).isTrue();
    assertThat(first.traceBytes()).isEqualTo(json.writeValueAsBytes(first.trace()).length);
    assertThat(second.trace()).isEmpty();
    assertThat(second.executedSteps()).isEqualTo(3);
    assertThat(second.timing().totalMicros())
        .isGreaterThanOrEqualTo(
            second.timing().preparationMicros() + second.timing().executionMicros());
    assertThat(second.durationMicros()).isEqualTo(second.timing().executionMicros());
  }

  @Test
  void changedDraftsNeverReusePublishedOrPreviousPreviewPlans() {
    var first = service.preview(new Preview(RuleSamples.blank("FORMULA"), Map.of("amount", 100)));
    var second = service.preview(new Preview(RuleSamples.blank("FORMULA"), Map.of("amount", 200)));
    assertThat(first.result()).isNotEqualTo(second.result());
    assertThat(validator.compilations).isEqualTo(2);
    verifyNoInteractions(rules);
  }

  @Test
  void storedDraftsAndPublishedVersionsRequireExplicitFunctionPrefixesWithoutRewritingHistory() {
    var input = new Node("input", "INPUT", "Inputs", null, null, null, null, null, null);
    var edge = new Edge("next", "input", "output", "next");
    var parameters = List.of(new Input("ROUND", "NUMBER", true, null));
    var oldDefinition =
        new Definition(
            1,
            parameters,
            List.of(
                input,
                new Node(
                    "output", "OUTPUT", "Result", null, "ROUND(ROUND, 2)", null, null, null, null)),
            List.of(edge));
    var updatedDefinition =
        new Definition(
            1,
            parameters,
            List.of(
                input,
                new Node(
                    "output",
                    "OUTPUT",
                    "Result",
                    null,
                    "$ROUND(ROUND, 2)",
                    null,
                    null,
                    null,
                    null)),
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
                assertThat(failure.locations())
                    .containsExactly(new ArcException.Location(null, null, "output", "Result"));
              });
    }
    assertThat(service.execute("old-rule", new Execution(inputs, 2)).result())
        .isEqualTo(new java.math.BigDecimal("1.24"));
    assertThat(oldDefinition.nodes().getLast().expression()).isEqualTo("ROUND(ROUND, 2)");
    verify(rules).publishedVersion("old-rule");
    verify(rules, times(2)).resolve("old-rule", 1);
    verify(rules).resolve("old-rule", 2);
    verifyNoMoreInteractions(rules);
  }

  @Test
  void cachedPublishedPlansKeepConcurrentRequestInputsIsolated() throws Exception {
    when(rules.resolve("rule", 1)).thenReturn(RuleSamples.blank("FORMULA"));
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
        assertThat(response.result())
            .isEqualTo(
                java.math.BigDecimal.valueOf(index + 1L).multiply(new java.math.BigDecimal("0.9")));
        assertThat(response.executedSteps()).isEqualTo(3);
        assertThat(response.trace()).isEmpty();
        assertThat(response.sources()).isEmpty();
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
            List.of(
                new Node("in", "INPUT", "Input", null, null, null, null, null, null),
                new Node("out", "OUTPUT", "Output", null, "1", null, null, null, null)),
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
                new Node("first", "REFERENCE", "First", null, null, "a", "slow", 1, Map.of()),
                new Node("second", "REFERENCE", "Second", null, null, "b", "later", 1, Map.of()),
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
  void legacyUnpublishedAndInvalidTimeoutErrorsRemainExplicit() {
    when(rules.publishedVersion("draft")).thenReturn(null);
    assertThatThrownBy(() -> service.execute("draft", new Execution(Map.of(), null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(409));
    assertThatThrownBy(() -> service.execute("draft", new Execution(Map.of(), null, true, 99)))
        .hasMessageContaining("100–30,000");
  }
}
