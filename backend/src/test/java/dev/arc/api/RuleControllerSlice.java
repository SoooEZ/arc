package dev.arc.api;

import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The rule controller's web slice, with the application's JSON configuration and its three services
 * mocked, for tests of what requests and responses look like. Subclasses share one cached context;
 * a new controller collaborator is mocked here.
 */
@WebMvcTest(RuleController.class)
abstract class RuleControllerSlice {
  @Autowired protected MockMvc mvc;
  @MockitoBean protected RuleService rules;
  @MockitoBean protected RuleCatalogService catalog;
  @MockitoBean protected RuleExecutionService execution;
}
