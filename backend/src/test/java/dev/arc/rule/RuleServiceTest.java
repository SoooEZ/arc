package dev.arc.rule;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Rule;
import java.time.Instant;
import java.util.List;
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
  void ruleIdsFollowTheSharedResourceIdPolicy() {
    String longest = "r" + "-1".repeat(39) + "z";
    service.create(new RuleService.Create(longest, "Longest", "", "FORMULA", null));
    verify(repository).create(eq(longest), eq("Longest"), eq(""), eq("FORMULA"), any());
    for (String id : new String[] {longest + "z", "Rule", "1rule", "rule_id", null}) {
      assertThatThrownBy(
              () -> service.create(new RuleService.Create(id, "Name", "", "FORMULA", null)))
          .as(String.valueOf(id))
          .hasMessage(
              "Rule ID must start with a lowercase letter and contain only lowercase letters,"
                  + " digits, and hyphens (max 80)");
    }
    verifyNoMoreInteractions(repository);
  }

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

  @Test
  void invalidResultNamesNeverCreateOrUpdateADraft() {
    when(repository.lock("example")).thenReturn(draft);
    for (String type : List.of("FORMULA", "TRANSFORM", "REFERENCE")) {
      for (String name : List.of("unit price", "$value", "@value")) {
        var invalid =
            new Definition(
                1,
                List.of(),
                List.of(nodeOf("result", type, "Result").output(name).build()),
                List.of());
        assertThatThrownBy(
                () ->
                    service.create(
                        new RuleService.Create("example", "Example", "", "RULE", invalid)))
            .hasMessageContaining("valid result variable");
        assertThatThrownBy(
                () -> service.update("example", new RuleService.Update("Example", "", 3, invalid)))
            .hasMessageContaining("valid result variable");
      }
    }
    verify(repository, never()).create(anyString(), anyString(), anyString(), anyString(), any());
    verify(repository, never()).update(anyString(), anyString(), anyString(), any());
    verifyNoInteractions(definitions);
  }
}
