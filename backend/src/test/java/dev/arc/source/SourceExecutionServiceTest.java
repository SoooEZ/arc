package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
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
import org.junit.jupiter.api.Test;

class SourceExecutionServiceTest {
  private final SourceRepository repository = mock(SourceRepository.class);
  private final SourceAdapter adapter = mock(SourceAdapter.class);
  private final SourceExecutionService execution;

  SourceExecutionServiceTest() {
    when(adapter.kind()).thenReturn("MEMORY");
    execution =
        new SourceExecutionService(
            repository,
            new SourceAdapters(List.of(adapter)),
            new JsonPointerExtractor(new ObjectMapper()));
  }

  @Test
  void omittedVersionUsesOneCurrentSnapshotWithoutLoadingHistory() {
    DataSource source = source(3, true);
    when(repository.latest("memory")).thenReturn(source);
    when(adapter.fetch("memory", source.definition(), Map.of("key", new BigDecimal("12"))))
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
    when(adapter.fetch("memory", source.definition(), Map.of("key", new BigDecimal("4"))))
        .thenReturn("pinned");

    assertThat(execution.test("memory", new SourceExecutionService.Test(Map.of("key", 4), 1)))
        .isEqualTo("pinned");
    verify(repository).get("memory", 1);
    verifyNoMoreInteractions(repository);
  }

  @Test
  void bindingReadsUseTheSameTypedProviderDispatchAndThenExtractThePointer() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch("memory", source.definition(), Map.of("key", new BigDecimal("12"))))
        .thenReturn(Map.of("value", 12));

    Object value =
        execution.read(new SourceBinding("memory", 1, Map.of(), "/value", "FAIL"), Map.of());

    assertThat(value).isEqualTo(12);
    verify(adapter).fetch("memory", source.definition(), Map.of("key", new BigDecimal("12")));
    assertThatThrownBy(
            () ->
                execution.test("memory", new SourceExecutionService.Test(Map.of("key", "bad"), 1)))
        .hasMessageContaining("must be number");
    assertThatThrownBy(
            () ->
                execution.test("memory", new SourceExecutionService.Test(Map.of("unknown", 3), 1)))
        .hasMessageContaining("Unknown source parameter");
    verify(adapter, times(1)).fetch(any(), any(), any());
  }

  @Test
  void optionalExplicitNullReachesTheProviderInsteadOfUsingTheDefault() {
    DataSource source = source(1, false);
    when(repository.get("memory", 1)).thenReturn(source);
    var inputs = new HashMap<String, Object>();
    inputs.put("key", null);
    when(adapter.fetch("memory", source.definition(), inputs)).thenReturn("null received");

    assertThat(execution.test("memory", new SourceExecutionService.Test(inputs, 1)))
        .isEqualTo("null received");
    verify(adapter).fetch("memory", source.definition(), inputs);
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
    verify(adapter, never()).fetch(any(), any(), any());
  }

  @Test
  void latestLookupFailureKeepsTheSourceNotFoundError() {
    when(repository.latest("missing")).thenThrow(new ArcException(404, "Source not found"));
    assertThatThrownBy(
            () -> execution.test("missing", new SourceExecutionService.Test(Map.of(), null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Source not found");
    verify(adapter, never()).fetch(any(), any(), any());
  }

  @Test
  void validationAndExecutionSharePinnedConfigurationsButNeverProviderValues() {
    DataSource source = source(1, true);
    when(repository.get("memory", 1)).thenReturn(source);
    when(adapter.fetch("memory", source.definition(), Map.of("key", new BigDecimal("12"))))
        .thenReturn(10, 20);
    doCallRealMethod().when(adapter).fetch(any(), any(), any(), any());
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
        .fetch("memory", source.definition(), Map.of("key", new BigDecimal("12")));
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
    verify(adapter, never()).fetch(any(), any(), any());
  }

  @Test
  void cachedLookupConfigurationIsAnImmutableSnapshotIncludingNestedNulls() {
    var values = new java.util.ArrayList<Object>();
    values.add(null);
    values.add(1);
    var entries = new HashMap<String, Object>();
    entries.put("US", values);
    var definition = new SourceDefinition("LOOKUP", null, List.of(), entries, Map.of(), 0);
    when(repository.get("lookup", 1)).thenReturn(new DataSource("lookup", "Lookup", 1, definition));

    var snapshot = execution.openSession().definition("lookup", 1);
    values.add(2);
    entries.clear();

    assertThat(snapshot.entries().get("US")).isEqualTo(java.util.Arrays.asList(null, 1));
    assertThatThrownBy(() -> snapshot.entries().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> ((List<?>) snapshot.entries().get("US")).clear())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  private DataSource source(int version, boolean required) {
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", required, 12)), null, null, 0);
    return new DataSource("memory", "Memory", version, definition);
  }
}
