package dev.arc.api;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.model.DataSource;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import dev.arc.source.SourceAdapters;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceRepository;
import dev.arc.source.SourceService;
import dev.arc.source.SourceValidator;
import dev.arc.source.http.HttpSource;
import dev.arc.source.http.HttpSourceAdapter;
import dev.arc.source.lookup.LookupSourceAdapter;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * A field the specification requires and the application's mapper cannot refuse on its own: a
 * primitive component read an omitted or null {@code required} as false and {@code timeoutMs} as 0,
 * so a direct API client stored an optional input, or a lookup timeout of 0, with no error (lesson
 * B29). The flag is now boxed and the shape checks name what is missing.
 */
@WebMvcTest({RuleController.class, SourceController.class})
@Import({
  RuleService.class,
  RuleCatalogService.class,
  Validator.class,
  SourceService.class,
  SourceValidator.class,
  SourceAdapters.class,
  LookupSourceAdapter.class,
  HttpSourceAdapter.class,
  HttpSource.class
})
class RequiredFlagWebTest {
  @Autowired private MockMvc mvc;
  @MockitoBean private RuleRepository rules;
  @MockitoBean private RuleCatalog catalog;
  @MockitoBean private RuleTestCaseRepository testCases;
  @MockitoBean private RuleDefinitionService definitions;
  @MockitoBean private Engine engine;
  @MockitoBean private RuleExecutionService execution;
  @MockitoBean private SourceRepository sources;
  @MockitoBean private SourceExecutionService sourceExecution;

  @Test
  void aRuleInputWithoutARequiredFlagIsRefusedAndNamed() throws Exception {
    when(rules.lockForSave("rates")).thenReturn(4);
    for (String required : List.of("", "\"required\":null,")) {
      String definition =
          "{\"schemaVersion\":1,\"inputs\":[{\"name\":\"amount\",\"type\":\"NUMBER\","
              + required
              + "\"defaultValue\":null}],\"nodes\":[{\"id\":\"in\",\"type\":\"INPUT\","
              + "\"label\":\"Inputs\"}],\"edges\":[]}";
      String expected = "Declare whether input amount is required (true or false)";
      send(
              put("/api/rules/rates"),
              "{\"name\":\"Rates\",\"revision\":4,\"definition\":" + definition + "}")
          .andExpect(status().isUnprocessableEntity())
          .andExpect(jsonPath("$.message").value(expected));
      send(
              post("/api/rules"),
              "{\"id\":\"rates\",\"name\":\"Rates\",\"kind\":\"RULE\",\"definition\":"
                  + definition
                  + "}")
          .andExpect(status().isUnprocessableEntity())
          .andExpect(jsonPath("$.message").value(expected));
    }
    verify(rules, never()).update(anyString(), anyString(), anyString(), any(), any());
    verify(rules, never()).create(anyString(), anyString(), anyString(), anyString(), any(), any());
  }

  @Test
  void aSourceParameterWithoutARequiredFlagIsRefusedAndNamed() throws Exception {
    for (String required : List.of("", "\"required\":null,")) {
      String definition =
          "{\"kind\":\"LOOKUP\",\"parameters\":[{\"name\":\"key\",\"type\":\"STRING\","
              + required
              + "\"defaultValue\":null}],\"entries\":{},\"timeoutMs\":3000}";
      send(
              post("/api/sources"),
              "{\"id\":\"country-tax\",\"name\":\"Country tax\",\"definition\":" + definition + "}")
          .andExpect(status().isUnprocessableEntity())
          .andExpect(
              jsonPath("$.message")
                  .value("Declare whether source parameter key is required (true or false)"));
    }
    verify(sources, never()).create(anyString(), anyString(), any());
  }

  /**
   * The timeout belongs to the HTTP transport: an HTTP definition needs it, with the range message
   * its save always had, while a lookup table is stored and returned with whatever it sent, or with
   * nothing, as the versions created through the API before this check already are.
   */
  @Test
  void anHttpSourceNeedsItsTimeoutWhileALookupTableDoesNot() throws Exception {
    when(sources.create(anyString(), anyString(), any()))
        .thenAnswer(
            call ->
                new DataSource(call.getArgument(0), call.getArgument(1), 1, call.getArgument(2)));
    for (String timeout : List.of("", ",\"timeoutMs\":null", ",\"timeoutMs\":0")) {
      String definition =
          "{\"kind\":\"HTTP\",\"url\":\"https://example.com/rates\",\"parameters\":[]"
              + timeout
              + "}";
      send(
              post("/api/sources"),
              "{\"id\":\"remote\",\"name\":\"Remote\",\"definition\":" + definition + "}")
          .andExpect(status().isUnprocessableEntity())
          .andExpect(jsonPath("$.message").value("HTTP timeout must be 100–10,000 ms"));
    }
    verify(sources, never()).create(eq("remote"), anyString(), any());

    String table =
        "\"parameters\":[{\"name\":\"key\",\"type\":\"STRING\",\"required\":true}],"
            + "\"entries\":{\"US\":1}";
    send(
            post("/api/sources"),
            "{\"id\":\"table\",\"name\":\"Table\",\"definition\":{\"kind\":\"LOOKUP\","
                + table
                + "}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.definition.timeoutMs").value(nullValue()));
    send(
            post("/api/sources"),
            "{\"id\":\"legacy\",\"name\":\"Legacy\",\"definition\":{\"kind\":\"LOOKUP\","
                + table
                + ",\"timeoutMs\":0}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.definition.timeoutMs").value(0));
  }

  private ResultActions send(
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
      String body)
      throws Exception {
    return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body));
  }
}
