package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.SourceReader;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import dev.arc.rule.RuleSamples;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SourceExecutionServiceTest {
  private final SourceRepository repository = mock(SourceRepository.class);
  private final SourceAdapter adapter = mock(SourceAdapter.class);
  private final SourceExecutionService execution;

  SourceExecutionServiceTest() {
    when(adapter.kind()).thenReturn("MEMORY");
    execution =
        new SourceExecutionService(
            repository, new SourceAdapters(List.of(adapter)), new JsonPointerExtractor());
  }

  @Test
  void omittedVersionUsesOneCurrentSnapshotWithoutLoadingHistory() {
    DataSource source = source(3, true);
    when(repository.latest("memory")).thenReturn(source);
    when(adapter.fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("12"))), any()))
        .thenReturn("current");

    assertThat(execution.test("memory", new SourceExecutionService.Test(Map.of(), null)))
        .isEqualTo("current");
    verify(repository).latest("memory");
    verifyNoMoreInteractions(repository);
  }

  @Test
  void explicitVersionStaysPinnedEvenWhenTheCurrentVersionDiffers() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("4"))), any()))
        .thenReturn("pinned");

    assertThat(execution.test("memory", new SourceExecutionService.Test(Map.of("key", 4), 1)))
        .isEqualTo("pinned");
    verify(repository).get("memory", 1);
    verifyNoMoreInteractions(repository);
  }

  @Test
  void theTestEndpointReadsWithinTheDefaultExecutionDeadline() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    var deadline = ArgumentCaptor.forClass(ExecutionDeadline.class);
    when(adapter.fetch(any(), any(), any(), deadline.capture())).thenReturn("value");

    execution.test("memory", new SourceExecutionService.Test(Map.of(), 1));

    assertThat(deadline.getValue().remainingMillis())
        .isBetween(
            ExecutionDeadline.DEFAULT_TIMEOUT_MS - 5_000, ExecutionDeadline.DEFAULT_TIMEOUT_MS);
  }

  @Test
  void bindingReadsUseTheSameTypedProviderDispatchAndThenExtractThePointer() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("12"))), any()))
        .thenReturn(Map.of("value", 12));

    Object value =
        execution
            .openSession()
            .read(
                new SourceBinding("memory", 1, Map.of(), "/value", "FAIL"),
                Map.of(),
                ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS));

    assertThat(value).isEqualTo(12);
    verify(adapter)
        .fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("12"))), any());
    assertThatThrownBy(
            () ->
                execution.test("memory", new SourceExecutionService.Test(Map.of("key", "bad"), 1)))
        .hasMessageContaining("must be number");
    assertThatThrownBy(
            () ->
                execution.test("memory", new SourceExecutionService.Test(Map.of("unknown", 3), 1)))
        .hasMessageContaining("Unknown source parameter");
    verify(adapter, times(1)).fetch(any(), any(), any(), any());
  }

  @Test
  void aProviderImplementsOneFetchThatReceivesTheExecutionDeadline() {
    var received = new AtomicReference<ExecutionDeadline>();
    SourceAdapter table =
        new SourceAdapter() {
          @Override
          public String kind() {
            return "TABLE";
          }

          @Override
          public void validate(SourceDefinition definition) {}

          @Override
          public Object fetch(
              String sourceId,
              SourceDefinition definition,
              Map<String, Object> inputs,
              ExecutionDeadline deadline) {
            received.set(deadline);
            return Map.of("value", inputs.get("key"));
          }
        };
    var definition =
        new SourceDefinition(
            "TABLE", null, List.of(new Input("key", "NUMBER", true, null)), null, null, 0);
    when(repository.get("table", 1)).thenReturn(new DataSource("table", "Table", 1, definition));
    var service =
        new SourceExecutionService(
            repository, new SourceAdapters(List.of(table)), new JsonPointerExtractor());
    var deadline = ExecutionDeadline.start(1000);

    Object value =
        service
            .openSession()
            .read(
                new SourceBinding("table", 1, Map.of(), "/value", "FAIL"),
                Map.of("key", 7),
                deadline);

    assertThat(value).isEqualTo(new BigDecimal("7"));
    assertThat(received).hasValue(deadline);
  }

  @Test
  void aValueReturnedAfterTheDeadlineIsNotUsed() throws Exception {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch(any(), any(), any(), any()))
        .thenAnswer(
            call -> {
              Thread.sleep(150);
              return "late";
            });
    var session = execution.openSession();
    var binding = new SourceBinding("memory", 1, Map.of(), "", "FAIL");

    assertThatThrownBy(() -> session.read(binding, Map.of(), ExecutionDeadline.start(100)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE));
    var expired = ExecutionDeadline.start(100);
    Thread.sleep(120);
    assertThatThrownBy(() -> session.read(binding, Map.of(), expired))
        .hasMessage("Rule execution deadline exceeded");
    verify(adapter, times(1)).fetch(any(), any(), any(), any());
  }

  @Test
  void onlyRequestSessionsAreSourceReaders() {
    assertThat(SourceReader.class.isAssignableFrom(SourceExecutionService.class)).isFalse();
    assertThat(execution.openSession()).isInstanceOf(SourceReader.class);
  }

  @Test
  void optionalExplicitNullReachesTheProviderInsteadOfUsingTheDefault() {
    DataSource source = source(1, false);
    when(repository.get("memory", 1)).thenReturn(source);
    var inputs = new HashMap<String, Object>();
    inputs.put("key", null);
    when(adapter.fetch(eq("memory"), eq(source.definition()), eq(inputs), any()))
        .thenReturn("null received");

    assertThat(execution.test("memory", new SourceExecutionService.Test(inputs, 1)))
        .isEqualTo("null received");
    verify(adapter).fetch(eq("memory"), eq(source.definition()), eq(inputs), any());
  }

  @Test
  void requiredExplicitNullAndMissingInputObjectFailBeforeCallingTheProvider() {
    when(repository.get("memory", 1)).thenReturn(source(1, true));
    var inputs = new HashMap<String, Object>();
    inputs.put("key", null);
    assertThatThrownBy(() -> execution.test("memory", new SourceExecutionService.Test(inputs, 1)))
        .hasMessage("Missing source parameter: key");
    assertThatThrownBy(() -> execution.test("memory", new SourceExecutionService.Test(null, 1)))
        .hasMessage("Source inputs must be an object");
    verify(adapter, never()).fetch(any(), any(), any(), any());
  }

  @Test
  void latestLookupFailureKeepsTheSourceNotFoundError() {
    when(repository.latest("missing")).thenThrow(new ArcException(404, "Source not found"));
    assertThatThrownBy(
            () -> execution.test("missing", new SourceExecutionService.Test(Map.of(), null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Source not found");
    verify(adapter, never()).fetch(any(), any(), any(), any());
  }

  @Test
  void validationAndExecutionSharePinnedConfigurationsButNeverProviderValues() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("12"))), any()))
        .thenReturn(10, 20);
    var binding = new SourceBinding("memory", 1, Map.of(), "", "FAIL");
    var blank = RuleSamples.blank("FORMULA");
    var definition =
        new Definition(
            1,
            List.of(
                new Input("first", "NUMBER", true, null, binding),
                new Input("second", "NUMBER", true, null, binding)),
            blank.nodes(),
            blank.edges());
    var session = execution.openSession();
    new SourceBindingValidator(repository)
        .validate(definition, (id, version) -> null, session::definition);

    assertThat(session.read(binding, Map.of(), ExecutionDeadline.start(1000))).isEqualTo(10);
    assertThat(session.read(binding, Map.of(), ExecutionDeadline.start(1000))).isEqualTo(20);
    verify(repository).get("memory", 1);
    verify(adapter, times(2))
        .fetch(
            eq("memory"), eq(source.definition()), eq(Map.of("key", new BigDecimal("12"))), any());
  }

  @Test
  void configurationCacheSeparatesVersionsAndDoesNotSurviveTheRequest() {
    when(repository.get("memory", 1)).thenReturn(source(1, true));
    when(repository.get("memory", 2)).thenReturn(source(2, false));
    var session = execution.openSession();

    assertThat(session.definition("memory", 1).parameters().getFirst().required()).isTrue();
    assertThat(session.definition("memory", 2).parameters().getFirst().required()).isFalse();
    session.definition("memory", 1);
    execution.openSession().definition("memory", 1);

    verify(repository, times(2)).get("memory", 1);
    verify(repository).get("memory", 2);
    verify(adapter, never()).fetch(any(), any(), any(), any());
  }

  @Test
  void cachedLookupConfigurationIsAnImmutableSnapshotIncludingNestedNulls() {
    var values = new java.util.ArrayList<Object>();
    values.add(null);
    values.add(1);
    var entries = new HashMap<String, Object>();
    entries.put("US", values);
    var parameters = new java.util.ArrayList<Input>();
    var definition = new SourceDefinition("LOOKUP", null, parameters, entries, Map.of(), 0);
    when(repository.get("lookup", 1)).thenReturn(new DataSource("lookup", "Lookup", 1, definition));

    var snapshot = execution.openSession().definition("lookup", 1);
    values.add(2);
    entries.clear();
    parameters.add(new Input("key", "STRING", true, null));

    assertThat(snapshot.entries().get("US")).isEqualTo(java.util.Arrays.asList(null, 1));
    assertThat(snapshot.parameters()).isEmpty();
    assertThatThrownBy(() -> snapshot.entries().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> ((List<?>) snapshot.entries().get("US")).clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> snapshot.parameters().clear())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  private DataSource source(int version, boolean required) {
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", required, 12)), null, null, 0);
    return new DataSource("memory", "Memory", version, definition);
  }
}
