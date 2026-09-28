package dev.arc.rule;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import dev.arc.model.Rule;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class RuleSamplesTest {
  private final RuleRepository store = mock(RuleRepository.class);
  private final RuleService service = mock(RuleService.class);
  private final RuleSamples samples = new RuleSamples(store, service);

  @Test
  void startupNeverLoadsStoredRulesToDecideWhetherToSeed() {
    when(store.hasRules()).thenReturn(true);
    samples.run(null);
    verify(store).hasRules();
    verifyNoMoreInteractions(store);
    verifyNoInteractions(service);
  }

  @Test
  void anEmptyDatabaseReceivesThePublishedExamples() {
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
  }
}
