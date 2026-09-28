package dev.arc.rule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import dev.arc.model.NodeKind;
import dev.arc.model.Rule;
import dev.arc.model.RuleKind;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class RuleSamplesTest {
  private final RuleRepository store = mock(RuleRepository.class);
  private final RuleService service = mock(RuleService.class);
  private final RuleSamples samples = new RuleSamples(store, service);

  /** Every kind starts from a decided template: a Condition for a RULE, a calculation otherwise. */
  @Test
  void eachKindStartsFromItsTemplate() {
    var rule = RuleSamples.blank(RuleKind.RULE);
    assertThat(rule.nodesOf(NodeKind.CONDITION)).hasSize(1);
    assertThat(rule.nodesOf(NodeKind.OUTPUT)).hasSize(2);
    for (RuleKind kind : List.of(RuleKind.FORMULA, RuleKind.DECISION_TREE)) {
      var calculation = RuleSamples.blank(kind);
      assertThat(calculation).as(kind.name()).isEqualTo(RuleSamples.blank(RuleKind.FORMULA));
      assertThat(calculation.nodesOf(NodeKind.FORMULA)).as(kind.name()).hasSize(1);
      assertThat(calculation.nodesOf(NodeKind.CONDITION)).as(kind.name()).isEmpty();
    }
  }

  /** A workspace seeded before, even one whose rules were all deleted since, is left alone. */
  @Test
  void aRefusedClaimSeedsNothingAndNeverLoadsStoredRules() {
    when(store.claimSampleSeeding()).thenReturn(false);
    samples.run(null);
    verify(store).claimSampleSeeding();
    verifyNoMoreInteractions(store);
    verifyNoInteractions(service);
  }

  @Test
  void aNewWorkspaceReceivesThePublishedExamples() {
    when(store.claimSampleSeeding()).thenReturn(true);
    when(store.create(anyString(), anyString(), anyString(), anyString(), any()))
        .thenAnswer(
            call ->
                new Rule(
                    call.getArgument(0),
                    call.getArgument(1),
                    call.getArgument(2),
                    call.getArgument(3),
                    call.getArgument(4),
                    1,
                    null,
                    Instant.EPOCH,
                    Instant.EPOCH));
    samples.run(null);
    verify(store, never()).list();
    for (String id : new String[] {"apply-discount", "order-pricing", "free-shipping"})
      verify(service).publish(id, 1);
    verify(store).create(eq("apply-discount"), anyString(), anyString(), eq("FORMULA"), any());
    verify(store).create(eq("order-pricing"), anyString(), anyString(), eq("DECISION_TREE"), any());
    verify(store)
        .create(
            eq("free-shipping"),
            anyString(),
            anyString(),
            eq("RULE"),
            eq(RuleSamples.blank(RuleKind.RULE)));
  }
}
