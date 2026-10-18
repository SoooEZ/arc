package dev.arc.api;

import static dev.arc.support.GraphFixtures.calculation;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Rule;
import dev.arc.model.RuleVersion;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * POST /api/rules/{id}/duplicate under the application's Jackson configuration, through the real
 * service and mocked stores: a strict body (lesson B32), the original's 404 before the body's 422s
 * (lesson B29), create's own ID, name and conflict outcomes, and the copied tests.
 */
@WebMvcTest(RuleController.class)
@Import({RuleService.class, RuleCatalogService.class, Validator.class})
class RuleDuplicationWebTest {
  private static final String DUPLICATE = "/api/rules/pricing/duplicate";

  @Autowired private MockMvc mvc;
  @MockitoBean private RuleRepository rules;
  @MockitoBean private RuleCatalog catalog;
  @MockitoBean private RuleTestCaseRepository testCases;
  @MockitoBean private RuleDefinitionService definitions;
  @MockitoBean private Engine engine;
  @MockitoBean private RuleExecutionService execution;

  private final Rule original =
      new Rule(
          "pricing",
          "Pricing",
          "Prices orders",
          "FORMULA",
          calculation(),
          7,
          2,
          Instant.EPOCH,
          Instant.EPOCH);

  @BeforeEach
  void anOriginalWithTwoVersions() {
    when(rules.lockForCopy("pricing")).thenReturn(original);
    when(rules.create(anyString(), anyString(), anyString(), anyString(), any(), any()))
        .thenAnswer(
            call ->
                new Rule(
                    call.getArgument(0),
                    call.getArgument(1),
                    call.getArgument(2),
                    call.getArgument(3),
                    call.getArgument(4),
                    8,
                    null,
                    Instant.EPOCH,
                    Instant.EPOCH));
  }

  /** The copy is a new, unpublished rule of the original's kind, answered as a create is. */
  @Test
  void aCopyIsCreatedWithTheOriginalsDraftKindDescriptionAndTests() throws Exception {
    send("{\"id\":\"pricing-copy\",\"name\":\"Pricing (copy)\"}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value("pricing-copy"))
        .andExpect(jsonPath("$.name").value("Pricing (copy)"))
        .andExpect(jsonPath("$.description").value("Prices orders"))
        .andExpect(jsonPath("$.kind").value("FORMULA"))
        .andExpect(jsonPath("$.publishedVersion").value(nullValue()))
        .andExpect(jsonPath("$.draft.nodes.length()").value(calculation().nodes().size()));
    verify(rules)
        .create(
            "pricing-copy", "Pricing (copy)", "Prices orders", "FORMULA", calculation(), Set.of());
    verify(testCases).copyCases("pricing", "pricing-copy");

    // A null includeTests is the default, as an omitted one is.
    send("{\"id\":\"second-copy\",\"name\":\"Second\",\"includeTests\":null}")
        .andExpect(status().isCreated());
    verify(testCases).copyCases("pricing", "second-copy");
  }

  /** A published version replaces the draft; "" replaces the description; tests can stay. */
  @Test
  void aVersionCanBeCopiedWithAnEmptyDescriptionAndWithoutTests() throws Exception {
    var published = calculation();
    when(rules.version("pricing", 1))
        .thenReturn(new RuleVersion("pricing", 1, published, Instant.EPOCH));
    send("{\"id\":\"v1-copy\",\"name\":\"V1\",\"description\":\"\",\"version\":1,"
            + "\"includeTests\":false}")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.description").value(""));
    verify(rules).create("v1-copy", "V1", "", "FORMULA", published, Set.of());
    verifyNoInteractions(testCases);
  }

  @Test
  void theBodyIsReadStrictly() throws Exception {
    send("{\"id\":\"copy\",\"name\":\"Copy\",\"includeTest\":false}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Request contains an unknown field: includeTest"));
    send("{\"id\":\"copy\",\"name\":\"Copy\",\"version\":1.5}")
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message").value("Request contains malformed JSON or an invalid value"));
    send("{\"id\":\"copy\",\"name\":\"Copy\"} {}").andExpect(status().isBadRequest());
    verify(rules, never()).create(anyString(), anyString(), anyString(), anyString(), any(), any());
  }

  /**
   * An unknown original is a 404 whatever the body holds; then the body's ID and name are checked
   * as a create checks them, a version the original lacks is its 404, and a taken ID is create's
   * 409. Nothing is copied by a refused request.
   */
  @Test
  void refusedCopiesAnswerAsCreatesAndTheVersionReadDo() throws Exception {
    when(rules.lockForCopy("gone")).thenThrow(ArcException.notFound("Rule not found: gone"));
    mvc.perform(
            post("/api/rules/gone/duplicate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"Bad ID\",\"name\":\"\"}"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Rule not found: gone"));

    send("{\"id\":\"Bad ID\",\"name\":\"Copy\"}")
        .andExpect(status().isUnprocessableEntity())
        .andExpect(
            jsonPath("$.message")
                .value(
                    "Rule ID must start with a lowercase letter and contain only lowercase"
                        + " letters, digits, and hyphens (max 80)"));
    send("{\"id\":\"copy\",\"name\":\"   \"}")
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.message").value("Rule name must contain 1 to 160 characters"));

    when(rules.version("pricing", 9))
        .thenThrow(ArcException.notFound("Published rule version not found: pricing v9"));
    send("{\"id\":\"copy\",\"name\":\"Copy\",\"version\":9}")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Published rule version not found: pricing v9"));

    when(rules.create(eq("taken"), anyString(), anyString(), anyString(), any(), any()))
        .thenThrow(ArcException.conflict("This rule ID already exists"));
    send("{\"id\":\"taken\",\"name\":\"Copy\"}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("This rule ID already exists"));
    verifyNoInteractions(testCases);
  }

  private ResultActions send(String body) throws Exception {
    return mvc.perform(post(DUPLICATE).contentType(MediaType.APPLICATION_JSON).content(body));
  }
}
