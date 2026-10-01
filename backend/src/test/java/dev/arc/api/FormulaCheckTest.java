package dev.arc.api;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleRepository;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceRepository;
import dev.arc.source.SourceVersions;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class FormulaCheckTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final RuleDefinitionService definitions =
      new RuleDefinitionService(
          validator,
          rules,
          new SourceBindingValidator(new SourceVersions(sources)),
          new Engine(validator));
  private final org.springframework.test.web.servlet.MockMvc mvc =
      MockMvcBuilders.standaloneSetup(new StudioController(script, definitions)).build();

  @Test
  void httpChecksFormulaPinKindAndArityOfWellFormedCalls() throws Exception {
    var child =
        new Definition(1, List.of(new Input("value", "NUMBER", true, null)), List.of(), List.of());
    when(rules.resolveFormula("child", 1)).thenReturn(child);
    when(rules.resolveFormula("child", 2))
        .thenThrow(new ArcException(404, "Published Formula version not found"));
    when(rules.resolveFormula("tree", 1))
        .thenThrow(ArcException.invalid("@ calls require a published Formula: tree"));
    check("@child:1(amount) + @child:1(amount)")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.valid").value(true))
        .andExpect(jsonPath("$.variables[0]").value("amount"))
        .andExpect(jsonPath("$.formulaCalls[0].id").value("child"))
        .andExpect(jsonPath("$.formulaCalls[0].version").value(1))
        .andExpect(jsonPath("$.formulaCalls[0].argumentCount").value(1))
        // The record lives with its producer now; its JSON is byte for byte what it was.
        .andExpect(
            content()
                .string(
                    "{\"valid\":true,\"variables\":[\"amount\"],\"error\":null,"
                        + "\"formulaCalls\":[{\"id\":\"child\",\"version\":1,\"argumentCount\":1},"
                        + "{\"id\":\"child\",\"version\":1,\"argumentCount\":1}]}"));
    verify(rules, times(1)).resolveFormula("child", 1);
    for (String expression : List.of("@child:1()", "@child:1(1, 2)", "@child:2(1)", "@tree:1(1)")) {
      assertThatCode(() -> Expressions.compile(expression))
          .as(expression)
          .doesNotThrowAnyException();
      assertThat(definitions.checkExpression(expression).valid()).as(expression).isFalse();
      check(expression)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.valid").value(false))
          .andExpect(jsonPath("$.error").isNotEmpty());
    }
    verifyNoInteractions(sources);
  }

  @Test
  void httpReportsFreeVariablesAndSyntaxErrorsWithoutEvaluating() throws Exception {
    check("$MAP(items, item, item.price + factor)")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.valid").value(true))
        .andExpect(jsonPath("$.variables", containsInAnyOrder("items", "factor")))
        .andExpect(jsonPath("$.formulaCalls").isEmpty());
    check("$ROUND(ROUND, 2) + $ROUND(1, 0)")
        .andExpect(jsonPath("$.valid").value(true))
        .andExpect(jsonPath("$.variables", containsInAnyOrder("ROUND")));
    check("$SUM(1 +)")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.valid").value(false))
        .andExpect(jsonPath("$.variables").isEmpty())
        .andExpect(jsonPath("$.error").isNotEmpty());
    verifyNoInteractions(rules, sources);
  }

  private ResultActions check(String expression) throws Exception {
    return mvc.perform(
        post("/api/studio/expression/check")
            .contentType(MediaType.APPLICATION_JSON)
            .content(new ObjectMapper().writeValueAsString(Map.of("expression", expression))));
  }
}
