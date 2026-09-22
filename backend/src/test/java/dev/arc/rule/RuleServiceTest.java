package dev.arc.rule;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Rule;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class RuleServiceTest {
  private final RuleRepository repository = mock(RuleRepository.class);
  private final RuleDefinitionService definitions = mock(RuleDefinitionService.class);
  private final RuleService service = new RuleService(repository, new Validator(), definitions);
  private final Rule draft =
      new Rule(
          "example",
          "Example",
          "",
          "FORMULA",
          RuleSamples.blank("FORMULA"),
          3,
          1,
          Instant.EPOCH,
          Instant.EPOCH);

  @Test
  void staleEditsNeverWriteOrPublish() {
    when(repository.lock("example")).thenReturn(draft);
    assertThatThrownBy(
            () -> service.update("example", new RuleService.Update("New", "", 2, draft.draft())))
        .isInstanceOf(ArcException.class)
        .hasMessageContaining("changed in another editor");
    assertThatThrownBy(() -> service.publish("example", 2))
        .hasMessageContaining("changed in another editor");
    verify(repository, never()).update(anyString(), anyString(), anyString(), any());
    verify(repository, never()).publish(any());
    verifyNoInteractions(definitions);
  }

  @Test
  void invalidPublicationNeverPersistsAVersion() {
    when(repository.lock("example")).thenReturn(draft);
    doThrow(ArcException.invalid("Missing source mapping"))
        .when(definitions)
        .validate(draft.draft());
    assertThatThrownBy(() -> service.publish("example", 3))
        .hasMessageContaining("Missing source mapping");
    verify(repository, never()).publish(any());
  }

  @Test
  void publicationLocksAndValidatesBeforeSnapshotting() {
    when(repository.lock("example")).thenReturn(draft);
    when(repository.publish(draft)).thenReturn(draft);
    assertThat(service.publish("example", 3)).isSameAs(draft);
    var order = inOrder(repository, definitions);
    order.verify(repository).lock("example");
    order.verify(definitions).validate(draft.draft());
    order.verify(repository).publish(draft);
  }

  @Test
  void creationNormalizesMetadataAndUsesThePortableTemplate() {
    service.create(new RuleService.Create("valid-id", "  Example  ", null, "FORMULA", null));
    verify(repository)
        .create(
            eq("valid-id"), eq("Example"), eq(""), eq("FORMULA"), eq(RuleSamples.blank("FORMULA")));
  }
}
