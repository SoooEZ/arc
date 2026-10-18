package dev.arc.rule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import dev.arc.rule.RuleTestCaseRepository.Content;
import dev.arc.rule.RuleTestCaseService.Write;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class RuleTestCaseServiceTest {
  private final RuleTestCaseRepository store = mock(RuleTestCaseRepository.class);
  private final RuleTestCaseService service = new RuleTestCaseService(store);
  private final Map<String, Object> inputs =
      Map.of("orderTotal", new BigDecimal("150"), "customerTier", "premium");

  @Test
  void aCaseIsStoredWithItsNameTrimmedAndItsInputsAndExpectationAsWritten() {
    service.create(
        "pricing", new Write("  Premium order  ", inputs, new BigDecimal("120.00"), null));

    var content = ArgumentCaptor.forClass(Content.class);
    verify(store).create(eq("pricing"), content.capture());
    assertThat(content.getValue())
        .isEqualTo(new Content("Premium order", inputs, new BigDecimal("120.00"), null));
    // A null expected result is a result expectation of its own: the rule must return null.
    service.create("pricing", new Write("Nothing", Map.of(), null, null));
    verify(store).create("pricing", new Content("Nothing", Map.of(), null, null));
  }

  /**
   * Inputs are required and must be an object (lesson B29): a missing value never stands for {} and
   * a list is not read as malformed JSON, so the message names the field either way.
   */
  @Test
  void inputsThatAreMissingOrNotAnObjectAreRefusedAndNamed() {
    for (Object value : Arrays.asList(null, List.of(1), "amount", new BigDecimal("1"), true))
      assertThatThrownBy(() -> service.create("pricing", new Write("Case", value, null, null)))
          .as(String.valueOf(value))
          .isInstanceOfSatisfying(
              ArcException.class, error -> assertThat(error.status()).isEqualTo(422))
          .hasMessage("Test case inputs must be a JSON object; send {} for none");
    verify(store, never()).create(anyString(), any());
  }

  @Test
  void namesFollowTheDisplayNamePolicy() {
    for (String name : Arrays.asList(null, "", "   ", "x".repeat(Limits.MAX_NAME_CHARACTERS + 1)))
      assertThatThrownBy(() -> service.create("pricing", new Write(name, inputs, null, null)))
          .hasMessage("Test case name must contain 1 to 160 characters");
    assertThatThrownBy(() -> service.create("pricing", new Write("a\u0001b", inputs, null, null)))
        .hasMessage("Test case name cannot contain control characters");
    verify(store, never()).create(anyString(), any());
  }

  @Test
  void aCaseExpectsEitherAResultOrAnErrorThatHasText() {
    service.create("pricing", new Write("Fails", Map.of(), null, "Missing required input"));
    verify(store).create("pricing", new Content("Fails", Map.of(), null, "Missing required input"));

    var refused = new HashMap<String, Write>();
    refused.put(
        "A test case expects a result or an error, not both",
        new Write("Both", Map.of(), new BigDecimal("1"), "Missing"));
    refused.put(
        "Expected error must contain text; send null to expect a result instead",
        new Write("Blank", Map.of(), null, "  "));
    refused.put(
        "Expected error exceeds 2,000 characters",
        new Write("Long", Map.of(), null, "x".repeat(Limits.MAX_EXPECTED_ERROR_CHARACTERS + 1)));
    refused.put(
        "Text cannot contain the NUL character (U+0000)",
        new Write("Nul", Map.of(), null, "a\u0000b"));
    refused.forEach(
        (message, write) ->
            assertThatThrownBy(() -> service.create("pricing", write))
                .as(message)
                .isInstanceOfSatisfying(
                    ArcException.class, error -> assertThat(error.status()).isEqualTo(422))
                .hasMessage(message));
    String longest = "x".repeat(Limits.MAX_EXPECTED_ERROR_CHARACTERS);
    service.create("pricing", new Write("Longest", Map.of(), null, longest));
    verify(store).create("pricing", new Content("Longest", Map.of(), null, longest));
  }

  /**
   * The rule is locked and counted before anything else, so an unknown rule is a 404 whatever the
   * body says, and two concurrent creations cannot both pass the limit.
   */
  @Test
  void aRuleKeepsAtMostAHundredCasesCountedUnderItsLock() {
    when(store.lockForNewCase("pricing")).thenReturn(Limits.MAX_TEST_CASES);
    assertThatThrownBy(() -> service.create("pricing", new Write("One more", inputs, null, null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(422))
        .hasMessage("A rule keeps at most 100 test cases; delete one before adding another");
    verify(store, never()).create(anyString(), any());

    when(store.lockForNewCase("pricing")).thenReturn(Limits.MAX_TEST_CASES - 1);
    service.create("pricing", new Write("Last one", inputs, null, null));
    // Both creations counted under the lock; only the one within the limit stored a case.
    var order = inOrder(store);
    order.verify(store, times(2)).lockForNewCase("pricing");
    order.verify(store).create(eq("pricing"), any());

    when(store.lockForNewCase("gone")).thenThrow(ArcException.notFound("Rule not found: gone"));
    assertThatThrownBy(() -> service.create("gone", new Write(null, null, null, null)))
        .hasMessage("Rule not found: gone");
  }

  @Test
  void anUpdateFindsTheCaseBeforeCheckingWhatItWrites() {
    doThrow(ArcException.notFound("Test case not found: 9")).when(store).lockCase("pricing", 9);
    assertThatThrownBy(() -> service.update("pricing", 9, new Write(null, null, null, null)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(404))
        .hasMessage("Test case not found: 9");
    verify(store, never()).update(anyString(), anyLong(), any());

    service.update("pricing", 3, new Write(" Renamed ", inputs, null, "Missing"));
    var order = inOrder(store);
    order.verify(store).lockCase("pricing", 3);
    order.verify(store).update("pricing", 3, new Content("Renamed", inputs, null, "Missing"));
  }

  @Test
  void listsAndDeletionsGoToStorage() {
    service.list("pricing");
    service.delete("pricing", 4);
    verify(store).list("pricing");
    verify(store).delete("pricing", 4);
  }
}
