package dev.arc.api;

import static org.mockito.Mockito.mock;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import dev.arc.source.SourceExecutionService;
import dev.arc.source.SourceRepository;
import dev.arc.source.SourceService;
import dev.arc.source.SourceValidator;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * The rule and source controllers over their real services, for a standalone MockMvc with the
 * application's error mapping. Every collaborator defaults to a mock (definition checks to the real
 * {@link Validator}); a test replaces the ones it drives. A controller or service that gains a
 * collaborator changes here, not in every web test.
 */
final class RuleApi {
  private RuleRepository rules = mock(RuleRepository.class);
  private RuleTestCaseRepository testCases = mock(RuleTestCaseRepository.class);
  private RuleCatalog catalog = mock(RuleCatalog.class);
  private Engine engine = mock(Engine.class);
  private SourceRepository sources = mock(SourceRepository.class);

  RuleApi rules(RuleRepository rules) {
    this.rules = rules;
    return this;
  }

  RuleApi testCases(RuleTestCaseRepository testCases) {
    this.testCases = testCases;
    return this;
  }

  RuleApi catalog(RuleCatalog catalog) {
    this.catalog = catalog;
    return this;
  }

  RuleApi engine(Engine engine) {
    this.engine = engine;
    return this;
  }

  RuleApi sources(SourceRepository sources) {
    this.sources = sources;
    return this;
  }

  MockMvc mvc() {
    var ruleService =
        new RuleService(
            rules, testCases, new Validator(), mock(RuleDefinitionService.class), engine);
    return MockMvcBuilders.standaloneSetup(
            new RuleController(
                ruleService, new RuleCatalogService(catalog), mock(RuleExecutionService.class)),
            new SourceController(
                new SourceService(sources, mock(SourceValidator.class)),
                mock(SourceExecutionService.class)))
        .setControllerAdvice(new Errors())
        .build();
  }
}
