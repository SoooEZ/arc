package dev.arc.rule;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.Rule;
import dev.arc.model.RuleKind;
import dev.arc.rule.RuleRepository.StoredDefinition;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RuleServiceTest {
  private final RuleRepository repository = mock(RuleRepository.class);
  private final RuleDefinitionService definitions = mock(RuleDefinitionService.class);
  private final Engine engine = mock(Engine.class);
  private final RuleService service =
      new RuleService(repository, new Validator(), definitions, engine);
  private final Rule draft =
      new Rule(
          "example",
          "Example",
          "",
          "FORMULA",
          RuleSamples.blank(RuleKind.FORMULA),
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

  /** Payloads keep the kind as text; an unknown one is refused with the choice, never a 400. */
  @Test
  void unknownKindsAreRefusedByCreateAndByTheCatalogFilter() {
    for (String kind : Arrays.asList(null, "", "formula", "Formula", "LOOP"))
      assertThatThrownBy(
              () -> service.create(new RuleService.Create("valid-id", "Name", "", kind, null)))
          .as(String.valueOf(kind))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).isEqualTo("Choose DECISION_TREE, FORMULA, or RULE");
              });
    var page = new dev.arc.model.PageRequest(0, 20, "");
    for (String kind : List.of("formula", "LOOP"))
      assertThatThrownBy(() -> service.catalog(page, kind, false))
          .as(kind)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).isEqualTo("Unknown rule kind");
              });
    verify(repository, never()).catalog(any(), anyString(), anyBoolean());
    verify(repository, never()).create(anyString(), anyString(), anyString(), anyString(), any());
    for (RuleKind kind : RuleKind.values()) service.catalog(page, kind.name(), false);
    service.catalog(page, "", true);
    verify(repository).catalog(page, "", true);
    service.create(new RuleService.Create("tree", "Tree", "", "DECISION_TREE", null));
    verify(repository)
        .create(
            eq("tree"),
            eq("Tree"),
            eq(""),
            eq("DECISION_TREE"),
            eq(RuleSamples.blank(RuleKind.DECISION_TREE)));
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
            eq("valid-id"),
            eq("Example"),
            eq(""),
            eq("FORMULA"),
            eq(RuleSamples.blank(RuleKind.FORMULA)));
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

  /** A graph whose Input node leads to {@code node}; edges do not matter to dependencies. */
  private static Definition graphWith(Node node) {
    return new Definition(1, List.of(), List.of(inputNode("in", "Input"), node), List.of());
  }

  private static Definition returning(String expression) {
    return graphWith(outputNode("out", "Output", expression));
  }

  /**
   * The text search only narrows the candidates: a string, another rule's ID that contains this
   * one, and an unfinished expression mention the rule without calling it.
   */
  @Test
  void aRuleThatOnlyMentionsTheDeletedOneDoesNotKeepIt() {
    when(repository.lockForDeletion("example")).thenReturn(draft);
    when(repository.definitionsMentioning("example"))
        .thenReturn(
            List.of(
                new StoredDefinition("labels", 1, returning("\"example\"")),
                new StoredDefinition("other", 2, returning("@example-two:1()")),
                new StoredDefinition("unfinished", null, returning("@example:1("))));
    service.delete("example", null);
    var order = inOrder(repository, engine);
    order.verify(repository).lockForDeletion("example");
    order.verify(repository).delete("example");
    order.verify(engine).forget("example");
  }

  @Test
  void aRuleThatOtherRulesCallIsKeptAndEveryCallerIsNamed() {
    when(repository.lockForDeletion("example")).thenReturn(draft);
    Node reference = nodeOf("tax", "REFERENCE", "Tax").rule("example", 1).output("tax").build();
    when(repository.definitionsMentioning("example"))
        .thenReturn(
            List.of(
                new StoredDefinition("checkout", null, graphWith(reference)),
                new StoredDefinition("checkout", 3, returning("@example:1() * 2"))));
    assertThatThrownBy(() -> service.delete("example", null))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(409);
              assertThat(error.getMessage())
                  .isEqualTo(
                      "Other rules call this rule: checkout (draft), checkout v3. Remove those"
                          + " calls before deleting it.");
              assertThat(error.issues()).containsExactly("checkout (draft)", "checkout v3");
            });
    verify(repository, never()).delete(anyString());
    verifyNoInteractions(engine);
  }

  @Test
  void aLongCallerListNamesTheFirstFiveAndCountsTheRest() {
    when(repository.lockForDeletion("example")).thenReturn(draft);
    var callers = new ArrayList<StoredDefinition>();
    for (String id : List.of("a", "b", "c", "d", "e", "f", "g"))
      callers.add(new StoredDefinition(id, 1, returning("@example:1()")));
    when(repository.definitionsMentioning("example")).thenReturn(callers);
    assertThatThrownBy(() -> service.delete("example", null))
        .hasMessage(
            "Other rules call this rule: a v1, b v1, c v1, d v1, e v1 and 2 more. Remove those"
                + " calls before deleting it.")
        .isInstanceOfSatisfying(ArcException.class, error -> assertThat(error.issues()).hasSize(7));
  }

  @Test
  void deletingAMissingRuleIsNotFoundAndChangesNothing() {
    when(repository.lockForDeletion("missing"))
        .thenThrow(new ArcException(404, "Rule not found: missing"));
    assertThatThrownBy(() -> service.delete("missing", null)).hasMessage("Rule not found: missing");
    verify(repository, never()).delete(anyString());
    verifyNoInteractions(engine);
  }

  /** A rule published or replaced since the client read it is kept, as a stale save would be. */
  @Test
  void aDeletionWithAStaleRevisionIsRefusedBeforeAnythingIsRead() {
    when(repository.lockForDeletion("example")).thenReturn(draft);
    assertThatThrownBy(() -> service.delete("example", 2))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(409);
              assertThat(error.getMessage())
                  .isEqualTo(
                      "This rule changed in another editor. Reload it before saving, publishing or"
                          + " deleting.");
            });
    verify(repository, never()).definitionsMentioning(anyString());
    verify(repository, never()).delete(anyString());
    service.delete("example", 3);
    verify(repository).delete("example");
  }

  /**
   * The caller check counts every rule a stored draft names, not only the complete pins that
   * validation resolves: a Reference that has chosen its rule but not its version, and source
   * mappings of a draft without an Input node.
   */
  @Test
  void unfinishedDraftsKeepTheRulesTheyName() {
    when(repository.lockForDeletion("example")).thenReturn(draft);
    Node unpinned = nodeOf("tax", "REFERENCE", "Tax").rule("example", null).output("tax").build();
    var sourced =
        new Definition(
            1,
            List.of(
                new Input(
                    "amount",
                    "NUMBER",
                    true,
                    null,
                    new SourceBinding(
                        "rates", 1, Map.of("key", "$TO_STRING(@example:1(1))"), "/rate", "FAIL"))),
            List.of(outputNode("out", "Output", "amount")),
            List.of());
    when(repository.definitionsMentioning("example"))
        .thenReturn(
            List.of(
                new StoredDefinition("checkout", null, graphWith(unpinned)),
                new StoredDefinition("pricing", null, sourced)));
    assertThatThrownBy(() -> service.delete("example", null))
        .hasMessage(
            "Other rules call this rule: checkout (draft), pricing (draft). Remove those calls"
                + " before deleting it.");
    verify(repository, never()).delete(anyString());
  }

  /** The rules a draft calls are held against deletion before the write and until the commit. */
  @Test
  void savesAndPublicationsHoldTheRulesTheyCallAgainstDeletion() {
    Node reference = nodeOf("tax", "REFERENCE", "Tax").rule("callee", 1).output("tax").build();
    var calling = graphWith(reference);
    var callingDraft =
        new Rule("example", "Example", "", "RULE", calling, 3, null, Instant.EPOCH, Instant.EPOCH);
    when(repository.lock("example")).thenReturn(callingDraft);
    when(repository.publish(callingDraft)).thenReturn(callingDraft);

    service.publish("example", 3);
    var publication = inOrder(repository, definitions);
    publication.verify(repository).lock("example");
    publication.verify(repository).lockCallees(Set.of("callee"));
    publication.verify(definitions).validate(calling);
    publication.verify(repository).publish(callingDraft);

    service.update("example", new RuleService.Update("Example", "", 3, calling));
    var save = inOrder(repository);
    save.verify(repository).lockCallees(Set.of("callee"));
    save.verify(repository).update("example", "Example", "", calling);

    service.create(new RuleService.Create("caller", "Caller", "", "RULE", calling));
    var creation = inOrder(repository);
    creation.verify(repository).lockCallees(Set.of("callee"));
    creation.verify(repository).create("caller", "Caller", "", "RULE", calling);
  }

  @Test
  void namesAreStoredTrimmedAndNeverMadeOfControlCharacters() {
    when(repository.lock("example")).thenReturn(draft);
    service.create(new RuleService.Create("padded", "  Padded  ", "", "FORMULA", null));
    verify(repository).create(eq("padded"), eq("Padded"), eq(""), eq("FORMULA"), any());
    // Padding no longer counts toward the limit of the stored name.
    String longest = "n".repeat(160);
    service.create(new RuleService.Create("longest", "  " + longest + "  ", "", "FORMULA", null));
    verify(repository).create(eq("longest"), eq(longest), eq(""), eq("FORMULA"), any());
    // "\u0001\u0000" passed as non-blank, was trimmed to "" and stored empty, past the NUL check.
    assertThatThrownBy(
            () ->
                service.create(
                    new RuleService.Create("control", "\u0001\u0000", "", "FORMULA", null)))
        .hasMessage("Text cannot contain the NUL character (U+0000)");
    for (String name : List.of("\u0001", "a\tb", "line\nbreak"))
      assertThatThrownBy(
              () -> service.create(new RuleService.Create("control", name, "", "FORMULA", null)))
          .as(name)
          .hasMessage("Rule name cannot contain control characters");
    for (String name : Arrays.asList(null, "", "   ", "n".repeat(161)))
      assertThatThrownBy(
              () -> service.create(new RuleService.Create("empty", name, "", "FORMULA", null)))
          .as(String.valueOf(name))
          .hasMessage("Rule name must contain 1 to 160 characters");
    assertThatThrownBy(
            () -> service.update("example", new RuleService.Update("\u0001", "", 3, draft.draft())))
        .hasMessage("Rule name cannot contain control characters");
    verify(repository, never()).create(eq("control"), anyString(), anyString(), anyString(), any());
    verify(repository, never()).create(eq("empty"), anyString(), anyString(), anyString(), any());
    verify(repository, never()).update(anyString(), anyString(), anyString(), any());
  }

  @Test
  void notesAreStoredAsSingleTrimmedLinesAndBoundedAfterwards() {
    when(repository.lock("example")).thenReturn(draft);
    var base = draft.draft();
    var noted =
        new Definition(
            1,
            base.inputs(),
            base.nodes(),
            base.edges(),
            List.of("first\nsecond", "  padded  ", "a\rb"));
    service.update("example", new RuleService.Update("Example", "", 3, noted));
    verify(repository)
        .update(
            eq("example"),
            eq("Example"),
            eq(""),
            argThat(d -> d.notes().equals(List.of("first", "second", "padded", "a", "b"))));
    // One stored note with 600 line breaks rendered more comments than the code could build.
    var tooMany =
        new Definition(1, base.inputs(), base.nodes(), base.edges(), List.of("x\n".repeat(600)));
    assertThatThrownBy(
            () -> service.update("example", new RuleService.Update("Example", "", 3, tooMany)))
        .hasMessage("Too many or oversized comments");
  }
}
