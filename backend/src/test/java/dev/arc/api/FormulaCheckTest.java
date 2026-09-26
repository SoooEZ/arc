package dev.arc.api;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleDefinitionService;
import dev.arc.rule.RuleRepository;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceRepository;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class FormulaCheckTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final RuleDefinitionService definitions =
      new RuleDefinitionService(validator, rules, new SourceBindingValidator(sources));
  private final org.springframework.test.web.servlet.MockMvc mvc =
      MockMvcBuilders.standaloneSetup(new StudioController(script, definitions)).build();

  @Test
  void httpChecksFormulaPinKindAndArityButEmbeddedChecksStayLexical() throws Exception {
    var child =
        new Definition(1, List.of(new Input("value", "NUMBER", true, null)), List.of(), List.of());
    when(rules.resolveFormula("child", 1)).thenReturn(child);
    when(rules.resolveFormula("child", 2))
        .thenThrow(new ArcException(404, "Published Formula version not found"));
    when(rules.resolveFormula("tree", 1))
        .thenThrow(ArcException.invalid("@ calls require a published Formula: tree"));
    mvc.perform(
            post("/api/studio/expression/check")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"expression\":\"@child:1(amount) + @child:1(amount)\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.valid").value(true))
        .andExpect(jsonPath("$.variables[0]").value("amount"))
        .andExpect(jsonPath("$.formulaCalls[0].id").value("child"))
        .andExpect(jsonPath("$.formulaCalls[0].version").value(1))
        .andExpect(jsonPath("$.formulaCalls[0].argumentCount").value(1));
    verify(rules, times(1)).resolveFormula("child", 1);
    for (String expression : List.of("@child:1()", "@child:1(1, 2)", "@child:2(1)", "@tree:1(1)")) {
      var lexical = script.checkExpression(expression);
      assertThat(lexical.valid()).as(expression).isTrue();
      assertThat(definitions.checkExpression(expression).valid()).as(expression).isFalse();
      mvc.perform(
              post("/api/studio/expression/check")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(new ObjectMapper().writeValueAsString(Map.of("expression", expression))))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.valid").value(false))
          .andExpect(jsonPath("$.error").isNotEmpty());
    }
    verifyNoInteractions(sources);
  }
}
