package dev.arc.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleExecutionService.ExecutionResponse;
import dev.arc.rule.RuleExecutionService.Timing;
import dev.arc.rule.RuleService;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Responses use the application's Jackson configuration from application.yaml. */
@WebMvcTest(RuleController.class)
class JsonNumberTest {
  @Autowired private MockMvc mvc;
  @MockitoBean private RuleService rules;
  @MockitoBean private RuleExecutionService execution;

  @Test
  void decimalsAreWrittenWithoutExponentNotation() throws Exception {
    var result = new LinkedHashMap<String, Object>();
    result.put("factorial", new BigDecimal("1.2E+2"));
    result.put("truncated", new BigDecimal("2E+1"));
    result.put("thousand", new BigDecimal("1E+3"));
    result.put("rate", new BigDecimal("0.070"));
    result.put("tiny", new BigDecimal("1E-7"));
    when(execution.preview(any()))
        .thenReturn(
            new ExecutionResponse(
                "preview",
                null,
                new Engine.Result(result, List.of(), 0, List.of(), false, false, 0, 2),
                new Timing(0, 0, 0)));

    mvc.perform(
            post("/api/preview").contentType(MediaType.APPLICATION_JSON).content("{\"inputs\":{}}"))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    containsString(
                        "\"result\":{\"factorial\":120,\"truncated\":20,\"thousand\":1000,"
                            + "\"rate\":0.070,\"tiny\":0.0000001}")))
        .andExpect(content().string(not(containsString("E+"))));
  }
}
