package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
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

  private DataSource source(int version, boolean required) {
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", required, 12)), null, null, 0);
    return new DataSource("memory", "Memory", version, definition);
  }
}
