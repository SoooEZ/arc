package dev.arc.rule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Rule;
import dev.arc.model.RuleKind;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

class RuleSamplesTest {
  private static final String NOTE = "The sample's first version.";

  private final RuleRepository store = mock(RuleRepository.class);
  // The real service over the mocked store: samples are created and published as the API does it,
  // so the store sees the definition and the callee set each write stores.
  private final RuleService service =
      new RuleService(
          store,
          mock(RuleTestCaseRepository.class),
          new Validator(),
          mock(RuleDefinitionService.class),
          mock(Engine.class));
  private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
  private final RuleSamples samples = new RuleSamples(store, service, transactions);
  private final Map<String, Rule> stored = new HashMap<>();

  RuleSamplesTest() {
    when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    when(store.create(anyString(), anyString(), anyString(), anyString(), any(), any()))
        .thenAnswer(this::created);
    when(store.lockForPublication(anyString())).thenAnswer(call -> stored.get(call.getArgument(0)));
  }

  /** A workspace seeded before, even one whose rules were all deleted since, is left alone. */
  @Test
  void aRefusedClaimSeedsNothingAndNeverLoadsStoredRules() {
    when(store.claimSampleSeeding()).thenReturn(false);
    samples.run(null);
    // The service writes only through the store, so this also means nothing was created.
    verify(store).claimSampleSeeding();
    verifyNoMoreInteractions(store);
  }

  @Test
  void aNewWorkspaceReceivesThePublishedExamples() {
    when(store.claimSampleSeeding()).thenReturn(true);
    samples.run(null);
    // Stored rules are never loaded: the full list is a RuleCatalog read, which seeding has no
    // access to, so the old verify(store, never()).list() is now guaranteed by the type.
    verify(transactions).commit(any());
    // Each sample's version 1 carries the note and the callee set its draft stores.
    verify(store)
        .publish(argThat(rule -> rule.id().equals("apply-discount")), eq(Set.of()), eq(NOTE));
    verify(store)
        .publish(
            argThat(rule -> rule.id().equals("order-pricing")),
            eq(Set.of("apply-discount")),
            eq(NOTE));
    verify(store)
        .publish(argThat(rule -> rule.id().equals("free-shipping")), eq(Set.of()), eq(NOTE));
    verify(store)
        .create(eq("apply-discount"), anyString(), anyString(), eq("FORMULA"), any(), eq(Set.of()));
    // The pricing sample calls the discount formula; the stored set is what a deletion reads.
    verify(store)
        .create(
            eq("order-pricing"),
            anyString(),
            anyString(),
            eq("DECISION_TREE"),
            any(),
            eq(Set.of("apply-discount")));
    verify(store)
        .create(
            eq("free-shipping"),
            anyString(),
            anyString(),
            eq("RULE"),
            eq(RuleTemplates.blank(RuleKind.RULE)),
            eq(Set.of()));
  }

  /**
   * The API takes requests before the seed runs, so a sample ID may be taken already. Only the
   * samples roll back, to a savepoint inside the claim's transaction: the API starts and the claim
   * stays, where the seed's 409 used to stop every start.
   */
  @Test
  void aTakenSampleIdRollsBackOnlyTheSamples() {
    when(store.claimSampleSeeding()).thenReturn(true);
    when(store.create(eq("order-pricing"), anyString(), anyString(), anyString(), any(), any()))
        .thenThrow(new ArcException(409, "This rule ID already exists"));

    assertThatCode(() -> samples.run(null)).doesNotThrowAnyException();

    var definition = ArgumentCaptor.forClass(TransactionDefinition.class);
    verify(transactions).getTransaction(definition.capture());
    assertThat(definition.getValue().getPropagationBehavior())
        .isEqualTo(TransactionDefinition.PROPAGATION_NESTED);
    verify(transactions).rollback(any());
    verify(transactions, never()).commit(any());
    verify(store, never())
        .create(eq("free-shipping"), anyString(), anyString(), anyString(), any(), any());
  }

  /** A created rule at revision 1, which the publication then locks. */
  private Rule created(InvocationOnMock call) {
    Rule rule =
        new Rule(
            call.getArgument(0),
            call.getArgument(1),
            call.getArgument(2),
            call.getArgument(3),
            call.getArgument(4),
            1,
            null,
            Instant.EPOCH,
            Instant.EPOCH);
    stored.put(rule.id(), rule);
    return rule;
  }
}
