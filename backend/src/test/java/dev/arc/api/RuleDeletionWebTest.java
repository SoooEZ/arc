package dev.arc.api;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.rule.RuleCatalog;
import dev.arc.rule.RuleCatalogService;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleRepository;
import dev.arc.rule.RuleRepository.Caller;
import dev.arc.rule.RuleService;
import dev.arc.rule.RuleTestCaseRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** DELETE /api/rules/{id}: its statuses and the conflict body that clients read. */
class RuleDeletionWebTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final Engine engine = mock(Engine.class);
  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(
              new RuleController(
                  new RuleService(
                      rules,
                      mock(RuleTestCaseRepository.class),
                      new Validator(),
                      mock(RuleDefinitionService.class),
                      engine),
                  new RuleCatalogService(mock(RuleCatalog.class)),
                  mock(RuleExecutionService.class)))
          .setControllerAdvice(new Errors())
          .build();

  /**
   * The revision a client read is an optional precondition of a deletion; saves and publications
   * require one ({@link RevisionWebTest}).
   */
  @Test
  void aStaleRevisionIsAConflictAndTheCurrentOneDeletes() throws Exception {
    when(rules.lockForDeletion("rates")).thenReturn(4);
    mvc.perform(delete("/api/rules/rates").param("revision", "3"))
        .andExpect(status().isConflict())
        .andExpect(
            jsonPath("$.message")
                .value(
                    "This rule changed in another editor. Reload it before saving, publishing or"
                        + " deleting."));
    verify(rules, never()).delete(anyString());
    mvc.perform(delete("/api/rules/rates").param("revision", "4"))
        .andExpect(status().isNoContent());
    verify(rules).delete("rates");
  }

  @Test
  void aRuleThatNoOtherRuleCallsIsDeletedWithoutABody() throws Exception {
    mvc.perform(delete("/api/rules/old-draft"))
        .andExpect(status().isNoContent())
        .andExpect(content().string(""));
    verify(rules).delete("old-draft");
    verify(engine).forget("old-draft");
  }

  @Test
  void aCalledRuleIsAConflictWhoseIssuesListEveryCaller() throws Exception {
    when(rules.callersOf("rates")).thenReturn(List.of(new Caller("checkout", 4)));
    mvc.perform(delete("/api/rules/rates"))
        .andExpect(status().isConflict())
        .andExpect(
            jsonPath("$.message")
                .value(
                    "Other rules call this rule: checkout v4. Remove those calls before deleting"
                        + " it."))
        .andExpect(jsonPath("$.issues[0]").value("checkout v4"));
    verify(rules, never()).delete(anyString());
  }
}
