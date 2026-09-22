package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.List;
import org.junit.jupiter.api.Test;

class SourceServiceTest {
  @Test
  void aNewAdapterValidatesAndStoresConfigurationWithoutServiceChanges() {
    var repository = mock(SourceRepository.class);
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn("MEMORY");
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", true, 12)), null, null, 0);
    var service =
        new SourceService(repository, new SourceValidator(new SourceAdapters(List.of(adapter))));

    service.create(new SourceService.Create("memory", "Memory", definition));

    verify(adapter).validate(definition);
    verify(repository).create("memory", "Memory", definition);
    assertThatThrownBy(() -> new SourceAdapters(List.of(adapter)).require("unknown"))
        .hasMessage("Source kind must be MEMORY");
  }

  @Test
  void duplicateAdaptersFailFastInsteadOfSilentlyChangingBehavior() {
    var first = mock(SourceAdapter.class);
    var second = mock(SourceAdapter.class);
    when(first.kind()).thenReturn("MEMORY");
    when(second.kind()).thenReturn("MEMORY");
    assertThatThrownBy(() -> new SourceAdapters(List.of(first, second)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Duplicate source adapter");
  }
}
