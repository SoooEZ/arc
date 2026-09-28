package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.List;
import org.junit.jupiter.api.Test;

class SourceServiceTest {
  private final SourceRepository repository = mock(SourceRepository.class);
  private final SourceAdapter adapter = mock(SourceAdapter.class);
  private final SourceService service;
  private final SourceDefinition definition =
      new SourceDefinition(
          "MEMORY", null, List.of(new Input("key", "NUMBER", true, 12)), null, null, 0);

  SourceServiceTest() {
    when(adapter.kind()).thenReturn("MEMORY");
    service =
        new SourceService(repository, new SourceValidator(new SourceAdapters(List.of(adapter))));
  }

  @Test
  void aNewAdapterValidatesAndStoresConfigurationWithoutServiceChanges() {
    service.create(new SourceService.Create("memory", "Memory", definition));

    verify(adapter).validate(definition);
    verify(repository).create("memory", "Memory", definition);
    assertThatThrownBy(() -> new SourceAdapters(List.of(adapter)).require("unknown"))
        .hasMessage("Source kind must be MEMORY");
  }

  @Test
  void sourceIdsFollowTheSharedResourceIdPolicy() {
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
    when(repository.lock("memory")).thenReturn(1);
    for (String name :
        List.of("unit price", "price\t", "price ", "$ROUND", "round$", "@key", "key@")) {
      var invalid =
          new SourceDefinition(
              "MEMORY", null, List.of(new Input(name, "NUMBER", true, null)), null, null, 0);
      assertThatThrownBy(
              () -> service.create(new SourceService.Create("memory", "Memory", invalid)))
          .as(name)
          .hasMessage("Invalid source parameter");
      assertThatThrownBy(
              () -> service.update("memory", new SourceService.Update("Memory", 1, invalid)))
          .as(name)
          .hasMessage("Invalid source parameter");
    }
    // An invalid update locks its row first, like a rule save, but never writes.
    verify(repository, never()).create(anyString(), anyString(), any());
    verify(repository, never()).appendVersion(anyString(), anyString(), anyInt(), any());
    verify(adapter, never()).validate(any());
    var valid =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("ROUND", "NUMBER", true, null)), null, null, 0);
    service.create(new SourceService.Create("memory", "Memory", valid));
    verify(repository).create("memory", "Memory", valid);
  }

  @Test
  void sourceNamesFollowTheRuleNamePolicy() {
    when(repository.lock("memory")).thenReturn(1);
    // Sources kept their padding and accepted control characters, unlike rules.
    service.create(new SourceService.Create("memory", "  Memory  ", definition));
    verify(repository).create("memory", "Memory", definition);
    service.update("memory", new SourceService.Update("  Renamed  ", 1, definition));
    verify(repository).appendVersion("memory", "Renamed", 1, definition);
    for (String name : List.of("", "   ", "n".repeat(161)))
      assertThatThrownBy(() -> service.create(new SourceService.Create("memory", name, definition)))
          .as(name)
          .hasMessage("Source name must contain 1 to 160 characters");
    assertThatThrownBy(
            () -> service.update("memory", new SourceService.Update("\u0001", 1, definition)))
        .hasMessage("Source name cannot contain control characters");
    verify(repository, times(2)).lock("memory");
    verifyNoMoreInteractions(repository);
  }

  /**
   * A save runs lock, revision check, validation, write, in that order, like a rule save: a stale
   * editor learns of the conflict before its configuration is judged, and an invalid configuration
   * never reaches storage.
   */
  @Test
  void aSaveLocksAndChecksTheRevisionBeforeValidatingAndWritesOnlyAValidConfiguration() {
    when(repository.lock("memory")).thenReturn(2);
    var invalid =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("unit price", "NUMBER", true, null)), null, null, 0);

    assertThatThrownBy(
            () -> service.update("memory", new SourceService.Update("Memory", 1, invalid)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(409);
              assertThat(error.getMessage())
                  .isEqualTo("Source changed in another editor; reload before saving");
            });
    verify(adapter, never()).validate(any());
    verify(repository, never()).appendVersion(anyString(), anyString(), anyInt(), any());

    assertThatThrownBy(
            () -> service.update("memory", new SourceService.Update("Memory", 2, invalid)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage()).isEqualTo("Invalid source parameter");
            });
    verify(repository, never()).appendVersion(anyString(), anyString(), anyInt(), any());
  }

  @Test
  void aValidSaveLocksThenValidatesThenAppendsTheVersion() {
    when(repository.lock("memory")).thenReturn(2);
    service.update("memory", new SourceService.Update("Memory", 2, definition));
    var order = inOrder(repository, adapter);
    order.verify(repository).lock("memory");
    order.verify(adapter).validate(definition);
    order.verify(repository).appendVersion("memory", "Memory", 2, definition);
  }

  @Test
  void savingAnUnknownSourceIsNotFoundBeforeAnythingIsValidated() {
    when(repository.lock("missing")).thenThrow(new ArcException(404, "Source not found"));
    assertThatThrownBy(
            () -> service.update("missing", new SourceService.Update("Name", 1, definition)))
        .hasMessage("Source not found");
    verify(adapter, never()).validate(any());
    verify(repository, never()).appendVersion(anyString(), anyString(), anyInt(), any());
  }
}
