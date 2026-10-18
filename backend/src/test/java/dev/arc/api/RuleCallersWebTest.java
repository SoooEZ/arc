package dev.arc.api;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.CatalogPage;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Node;
import dev.arc.model.PageRequest;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalog.CallingRule;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import dev.arc.support.GraphFixtures;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * GET /api/rules/{id}/callers: the exact payload clients read, the catalogs' paging defaults and
 * bounds, and the 404 of an unknown rule.
 */
@WebMvcTest(RuleController.class)
@Import({RuleService.class, RuleCatalogService.class, Validator.class})
class RuleCallersWebTest {
  @Autowired private MockMvc mvc;
  @MockitoBean private RuleRepository rules;
  @MockitoBean private RuleCatalog catalog;
  @MockitoBean private RuleTestCaseRepository testCases;
  @MockitoBean private RuleDefinitionService definitions;
  @MockitoBean private Engine engine;
  @MockitoBean private RuleExecutionService execution;

  private static Definition pinning(Integer version) {
    Node reference =
        GraphFixtures.nodeOf("tax", "REFERENCE", "Tax").rule("rates", version).output("t").build();
    return new Definition(
        1, List.of(), List.of(GraphFixtures.inputNode("in", "Input"), reference), List.of());
  }

  /**
   * draftPins is null when the draft does not call the rule and empty while a Reference has no
   * version yet; published is null unless the latest version calls it. Both are always written.
   */
  @Test
  void eachCallerIsWrittenWithItsPinsAndEarlierVersions() throws Exception {
    when(catalog.callingRules("rates", new PageRequest(0, 20, "")))
        .thenReturn(
            new CatalogPage<>(
                List.of(
                    new CallingRule("checkout", "Checkout", 3, true, true, 2),
                    new CallingRule("drafts", "Drafts", null, true, false, 0),
                    new CallingRule("legacy", "Legacy", 4, false, false, 1)),
                3,
                0,
                20));
    when(catalog.callingDefinition("checkout", null, "rates")).thenReturn(Optional.of(pinning(2)));
    when(catalog.callingDefinition("checkout", 3, "rates")).thenReturn(Optional.of(pinning(1)));
    when(catalog.callingDefinition("drafts", null, "rates")).thenReturn(Optional.of(pinning(null)));

    mvc.perform(get("/api/rules/rates/callers"))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    "{\"items\":["
                        + "{\"ruleId\":\"checkout\",\"name\":\"Checkout\",\"draftPins\":[2],"
                        + "\"published\":{\"version\":3,\"pins\":[1]},\"earlierVersions\":2},"
                        + "{\"ruleId\":\"drafts\",\"name\":\"Drafts\",\"draftPins\":[],"
                        + "\"published\":null,\"earlierVersions\":0},"
                        + "{\"ruleId\":\"legacy\",\"name\":\"Legacy\",\"draftPins\":null,"
                        + "\"published\":null,\"earlierVersions\":1}],"
                        + "\"total\":3,\"offset\":0,\"limit\":20}"));
  }

  @Test
  void pagesUseTheCatalogDefaultsAndBounds() throws Exception {
    when(catalog.callingRules("rates", new PageRequest(40, 5, "")))
        .thenReturn(new CatalogPage<>(List.of(), 41, 40, 5));
    mvc.perform(get("/api/rules/rates/callers").param("offset", "40").param("limit", "5"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total").value(41))
        .andExpect(jsonPath("$.offset").value(40))
        .andExpect(jsonPath("$.limit").value(5));
    for (String[] bad : new String[][] {{"offset", "-1"}, {"limit", "0"}, {"limit", "101"}})
      mvc.perform(get("/api/rules/rates/callers").param(bad[0], bad[1]))
          .andExpect(status().isUnprocessableEntity())
          .andExpect(jsonPath("$.message").value("Use offset >= 0 and limit from 1 to 100"));
    // Only the request within bounds reached the store.
    verify(catalog).callingRules("rates", new PageRequest(40, 5, ""));
    verifyNoMoreInteractions(catalog);
  }

  @Test
  void anUnknownRuleIsNotFound() throws Exception {
    when(catalog.callingRules("gone", new PageRequest(0, 20, "")))
        .thenThrow(ArcException.notFound("Rule not found: gone"));
    mvc.perform(get("/api/rules/gone/callers"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Rule not found: gone"));
  }
}
