package dev.arc.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.error.ArcException;
import dev.arc.model.RuleTestCase;
import dev.arc.rule.RuleTestCaseRepository;
import dev.arc.rule.RuleTestCaseRepository.Content;
import dev.arc.rule.RuleTestCaseService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Test-case requests under the application's Jackson configuration, through the real service and a
 * mocked store: strict bodies (lesson B32), 404 before 422 and missing values named (lesson B29),
 * and the exact payload with decimals kept as written.
 */
@WebMvcTest(RuleTestCaseController.class)
@Import(RuleTestCaseService.class)
class RuleTestCaseWebTest {
  private static final String CASES = "/api/rules/pricing/test-cases";

  @Autowired private MockMvc mvc;
  @MockitoBean private RuleTestCaseRepository store;

  private static RuleTestCase stored(Object expectedResult, String expectedError) {
    var inputs = new LinkedHashMap<String, Object>();
    inputs.put("orderTotal", new BigDecimal("150.50"));
    inputs.put("customerTier", null);
    return new RuleTestCase(
        12,
        "pricing",
        "Premium order",
        inputs,
        expectedResult,
        expectedError,
        Instant.EPOCH,
        Instant.EPOCH);
  }

  @Test
  void aRulesCasesAreListedWithEveryFieldInOrder() throws Exception {
    when(store.list("pricing"))
        .thenReturn(List.of(stored(new BigDecimal("120.00"), null), stored(null, "Missing")));

    mvc.perform(get(CASES))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    "[{\"id\":12,\"ruleId\":\"pricing\",\"name\":\"Premium order\","
                        + "\"inputs\":{\"orderTotal\":150.50,\"customerTier\":null},"
                        + "\"expectedResult\":120.00,\"expectedError\":null,"
                        + "\"createdAt\":\"1970-01-01T00:00:00Z\","
                        + "\"updatedAt\":\"1970-01-01T00:00:00Z\"},"
                        + "{\"id\":12,\"ruleId\":\"pricing\",\"name\":\"Premium order\","
                        + "\"inputs\":{\"orderTotal\":150.50,\"customerTier\":null},"
                        + "\"expectedResult\":null,\"expectedError\":\"Missing\","
                        + "\"createdAt\":\"1970-01-01T00:00:00Z\","
                        + "\"updatedAt\":\"1970-01-01T00:00:00Z\"}]"));

    when(store.list("gone")).thenThrow(ArcException.notFound("Rule not found: gone"));
    mvc.perform(get("/api/rules/gone/test-cases"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Rule not found: gone"));
  }

  /** A created case answers 201 with the stored case; an explicit null input stays null. */
  @Test
  void aCreatedCaseIsStoredAsSentAndAnswered201() throws Exception {
    when(store.create(eq("pricing"), any())).thenReturn(stored(new BigDecimal("120.00"), null));

    send(
            post(CASES),
            "{\"name\":\" Premium order \",\"inputs\":{\"orderTotal\":150.50,"
                + "\"customerTier\":null},\"expectedResult\":120.00}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(12))
        .andExpect(jsonPath("$.expectedError").isEmpty());

    var inputs = new LinkedHashMap<String, Object>();
    inputs.put("orderTotal", new BigDecimal("150.50"));
    inputs.put("customerTier", null);
    verify(store)
        .create("pricing", new Content("Premium order", inputs, new BigDecimal("120.00"), null));
  }

  @Test
  void anUnknownFieldIsRefusedAndNamed() throws Exception {
    send(post(CASES), "{\"name\":\"Case\",\"inputs\":{},\"expected\":1}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Request contains an unknown field: expected"));
    send(put(CASES + "/3"), "{\"name\":\"Case\",\"inputs\":{},\"expectedErorr\":\"x\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Request contains an unknown field: expectedErorr"));
    mvc.perform(delete(CASES + "/three")).andExpect(status().isBadRequest());
    verify(store, never()).create(anyString(), any());
    verify(store, never()).update(anyString(), anyLong(), any());
    verify(store, never()).delete(anyString(), anyLong());
  }

  @Test
  void invalidContentIsA422ThatNamesTheField() throws Exception {
    Map<String, String> refused = new LinkedHashMap<>();
    refused.put("{\"name\":\"Case\"}", "Test case inputs must be a JSON object; send {} for none");
    refused.put(
        "{\"name\":\"Case\",\"inputs\":[1]}",
        "Test case inputs must be a JSON object; send {} for none");
    refused.put("{\"inputs\":{}}", "Test case name must contain 1 to 160 characters");
    refused.put(
        "{\"name\":\"Case\",\"inputs\":{},\"expectedResult\":1,\"expectedError\":\"x\"}",
        "A test case expects a result or an error, not both");
    refused.put(
        "{\"name\":\"Case\",\"inputs\":{},\"expectedError\":\"\"}",
        "Expected error must contain text; send null to expect a result instead");
    for (var request : refused.entrySet())
      send(post(CASES), request.getKey())
          .andExpect(status().isUnprocessableEntity())
          .andExpect(jsonPath("$.message").value(request.getValue()));
    verify(store, never()).create(anyString(), any());
  }

  /** The rule and the case are found before the body is checked. */
  @Test
  void aMissingRuleOrCaseIsA404WhateverTheBody() throws Exception {
    when(store.lockForNewCase("gone")).thenThrow(ArcException.notFound("Rule not found: gone"));
    send(post("/api/rules/gone/test-cases"), "{}")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Rule not found: gone"));
    doThrow(ArcException.notFound("Test case not found: 9")).when(store).lockCase("pricing", 9);
    send(put(CASES + "/9"), "{}")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Test case not found: 9"));
    doThrow(ArcException.notFound("Test case not found: 9")).when(store).delete("pricing", 9);
    mvc.perform(delete(CASES + "/9"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Test case not found: 9"));
  }

  @Test
  void anUpdateAnswersTheStoredCaseAndADeletionAnswers204() throws Exception {
    when(store.update(eq("pricing"), eq(3L), any())).thenReturn(stored(null, "Missing"));
    send(put(CASES + "/3"), "{\"name\":\"Fails\",\"inputs\":{},\"expectedError\":\"Missing\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expectedError").value("Missing"));
    verify(store).update("pricing", 3, new Content("Fails", Map.of(), null, "Missing"));

    mvc.perform(delete(CASES + "/3"))
        .andExpect(status().isNoContent())
        .andExpect(content().string(""));
    verify(store).delete("pricing", 3);
  }

  private ResultActions send(MockHttpServletRequestBuilder request, String body) throws Exception {
    return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body));
  }
}
