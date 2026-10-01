package dev.arc.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Request bodies are read strictly under the application's Jackson configuration: a misspelled
 * field, a second document after the body or a fraction where a whole number belongs is a 400,
 * never dropped or truncated into a different request.
 */
@WebMvcTest(RuleController.class)
class RequestJsonWebTest {
  @Autowired private MockMvc mvc;
  @MockitoBean private RuleService rules;
  @MockitoBean private RuleExecutionService execution;

  /**
   * "pointr" for "pointer" was dropped: the input read the source's whole response, failed its type
   * and fell back to the default on every run.
   */
  @Test
  void aMisspelledFieldIsRefusedAndNamed() throws Exception {
    String binding =
        "{\"id\":\"rates\",\"version\":1,\"bindings\":{},\"pointr\":\"/rate\","
            + "\"onError\":\"DEFAULT\"}";
    String input =
        "{\"name\":\"rate\",\"type\":\"NUMBER\",\"required\":false,\"defaultValue\":0.1,"
            + "\"source\":"
            + binding
            + "}";
    send("/api/preview", definitionWith(input))
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message")
                .value("Request contains an unknown field: definition.inputs[0].source.pointr"))
        .andExpect(jsonPath("$.issues").isEmpty());
    send("/api/rules/pricing/execute", "{\"inputs\":{},\"verison\":2}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Request contains an unknown field: verison"));
    verify(execution, never()).preview(any());
    verify(execution, never()).execute(anyString(), any());
  }

  @Test
  void aSecondDocumentAfterTheBodyIsRefused() throws Exception {
    send("/api/preview", definitionWith("") + " {\"inputs\":{\"amount\":1}}")
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message").value("Request contains malformed JSON or an invalid value"));
    verify(execution, never()).preview(any());
  }

  /** A version of 1.9 ran version 1, and a revision of 5.99 published over revision 5. */
  @Test
  void aFractionIsNeverTruncatedIntoAVersionOrARevision() throws Exception {
    send("/api/rules/pricing/execute", "{\"inputs\":{},\"version\":1.9}")
        .andExpect(status().isBadRequest());
    send("/api/rules/pricing/publish", "{\"revision\":5.99}").andExpect(status().isBadRequest());
    verify(execution, never()).execute(anyString(), any());
    verify(rules, never()).publish(anyString(), any());
  }

  private ResultActions send(String path, String body) throws Exception {
    return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  private static String definitionWith(String input) {
    return "{\"inputs\":{},\"definition\":{\"schemaVersion\":1,\"inputs\":["
        + input
        + "],\"nodes\":[],\"edges\":[]}}";
  }
}
