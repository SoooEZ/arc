package dev.arc.api;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The rule controller's web slice over the real rule services, with their storage, definition,
 * engine and execution collaborators mocked: requests pass the services' own checks while each test
 * arranges what the ports return. Subclasses share one cached context.
 */
@WebMvcTest(RuleController.class)
@Import({RuleService.class, RuleCatalogService.class, Validator.class})
abstract class RuleServicesSlice {
  @Autowired protected MockMvc mvc;
  @MockitoBean protected RuleRepository rules;
  @MockitoBean protected RuleCatalog catalog;
  @MockitoBean protected RuleTestCaseRepository testCases;
  @MockitoBean protected RuleDefinitionService definitions;
  @MockitoBean protected Engine engine;
  @MockitoBean protected RuleExecutionService execution;
}
