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
  void sourceIdsFollowTheSharedResourceIdPolicy() {
    var repository = mock(SourceRepository.class);
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn("MEMORY");
    var service =
        new SourceService(repository, new SourceValidator(new SourceAdapters(List.of(adapter))));
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", true, 12)), null, null, 0);
    String longest = "s" + "-1".repeat(39) + "z";
    service.create(new SourceService.Create(longest, "Longest", definition));
    verify(repository).create(longest, "Longest", definition);
    for (String id : new String[] {longest + "z", "Source", "1source", "source_id", null}) {
      assertThatThrownBy(() -> service.create(new SourceService.Create(id, "Name", definition)))
          .as(String.valueOf(id))
          .hasMessage("Invalid source ID");
    }
    verifyNoMoreInteractions(repository);
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

  @Test
  void sourceParameterNamesRejectWhitespaceAndFunctionPrefixesBeforeStorage() {
    var repository = mock(SourceRepository.class);
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn("MEMORY");
    var service =
        new SourceService(repository, new SourceValidator(new SourceAdapters(List.of(adapter))));
    for (String name :
        List.of("unit price", "price\t", "price\u00a0", "$ROUND", "round$", "@key", "key@")) {
      var definition =
          new SourceDefinition(
              "MEMORY", null, List.of(new Input(name, "NUMBER", true, null)), null, null, 0);
      assertThatThrownBy(
              () -> service.create(new SourceService.Create("memory", "Memory", definition)))
          .as(name)
          .hasMessage("Invalid source parameter");
      assertThatThrownBy(
              () -> service.update("memory", new SourceService.Update("Memory", 1, definition)))
          .as(name)
          .hasMessage("Invalid source parameter");
    }
    verifyNoInteractions(repository);
    verify(adapter, never()).validate(any());
    var valid =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("ROUND", "NUMBER", true, null)), null, null, 0);
    service.create(new SourceService.Create("memory", "Memory", valid));
    verify(repository).create("memory", "Memory", valid);
  }

  @Test
  void sourceNamesFollowTheRuleNamePolicy() {
    var repository = mock(SourceRepository.class);
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn("MEMORY");
    var service =
        new SourceService(repository, new SourceValidator(new SourceAdapters(List.of(adapter))));
    var definition =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", true, 12)), null, null, 0);
    // Sources kept their padding and accepted control characters, unlike rules.
    service.create(new SourceService.Create("memory", "  Memory  ", definition));
    verify(repository).create("memory", "Memory", definition);
    service.update("memory", new SourceService.Update("  Renamed  ", 1, definition));
    verify(repository).update("memory", "Renamed", 1, definition);
    for (String name : List.of("", "   ", "n".repeat(161)))
      assertThatThrownBy(() -> service.create(new SourceService.Create("memory", name, definition)))
          .as(name)
          .hasMessage("Source name must contain 1 to 160 characters");
    assertThatThrownBy(
            () -> service.update("memory", new SourceService.Update("\u0001", 1, definition)))
        .hasMessage("Source name cannot contain control characters");
    verifyNoMoreInteractions(repository);
  }
}
