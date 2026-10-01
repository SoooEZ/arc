package dev.arc.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Rule;
import dev.arc.model.RuleKind;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleSamples;
import dev.arc.rule.RuleService;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceRepository;
import dev.arc.source.SourceService;
import dev.arc.source.SourceValidator;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * A save or a publication names the revision its client read. A request without one is malformed,
 * not stale: it read as revision 0 and answered 409 "changed in another editor" however often the
 * client reloaded.
 */
class RevisionWebTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(
              new RuleController(
                  new RuleService(
                      rules,
                      new Validator(),
                      mock(RuleDefinitionService.class),
                      mock(Engine.class)),
                  mock(RuleExecutionService.class)),
              new SourceController(
                  new SourceService(sources, mock(SourceValidator.class)),
                  mock(SourceExecutionService.class)))
          .setControllerAdvice(new Errors())
          .build();

  @Test
  void aSaveOrPublicationWithoutARevisionIsInvalidRatherThanStale() throws Exception {
    when(rules.lock("rates")).thenReturn(rule());
    when(sources.lock("country-tax")).thenReturn(2);
    String draft = new ObjectMapper().writeValueAsString(RuleSamples.blank(RuleKind.FORMULA));
    String lookup = "{\"kind\":\"LOOKUP\",\"parameters\":[],\"entries\":{},\"timeoutMs\":3000}";

    for (String revision : List.of("", "\"revision\":null,")) {
      expectRevisionRequired(
          put("/api/rules/rates"),
          "{\"name\":\"Rates\"," + revision + "\"definition\":" + draft + "}");
      expectRevisionRequired(
          post("/api/rules/rates/publish"), "{" + revision.replaceFirst(",$", "") + "}");
      expectRevisionRequired(
          put("/api/sources/country-tax"),
          "{\"name\":\"Country tax\"," + revision + "\"definition\":" + lookup + "}");
    }
    verify(rules, never()).update(anyString(), anyString(), anyString(), any());
    verify(rules, never()).publish(any());
    verify(sources, never()).appendVersion(anyString(), anyString(), anyInt(), any());
  }

  private void expectRevisionRequired(MockHttpServletRequestBuilder request, String body)
      throws Exception {
    mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Revision is required"));
  }

  private static Rule rule() {
    return new Rule(
        "rates",
        "Rates",
        "",
        "FORMULA",
        RuleSamples.blank(RuleKind.FORMULA),
        4,
        null,
        Instant.EPOCH,
        Instant.EPOCH);
  }
}
