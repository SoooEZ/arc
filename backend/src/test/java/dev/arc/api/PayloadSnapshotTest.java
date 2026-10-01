package dev.arc.api;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.arc.engine.execution.Engine;
import dev.arc.engine.execution.Parameters;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Rule;
import dev.arc.rule.RuleExecutionService;
import dev.arc.rule.RuleExecutionService.ExecutionResponse;
import dev.arc.rule.RuleExecutionService.Timing;
import dev.arc.rule.RuleService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Exact HTTP payloads that model refactors must not change: field names, field order, nulls and
 * nesting, written with the application's Jackson configuration.
 */
@WebMvcTest(RuleController.class)
class PayloadSnapshotTest {
  @Autowired private MockMvc mvc;
  @MockitoBean private RuleService rules;
  @MockitoBean private RuleExecutionService execution;

  @Test
  void executionResponsesKeepEveryFieldInOrder() throws Exception {
    var result = new LinkedHashMap<String, Object>();
    result.put("total", new BigDecimal("12.50"));
    result.put("items", Arrays.asList(1, "a", true, null));
    var trace =
        List.of(
            new Engine.Step(
                "pricing", 3, "calc", "Calc", "FORMULA", new BigDecimal("12.50"), "next", 0),
            new Engine.Step("child", 1, "out", "Out", "OUTPUT", "x", null, 1));
    var sources =
        List.of(new Parameters.Read("rate", "country-tax", 2, Parameters.Read.Status.DEFAULT, 55));
    when(execution.preview(any()))
        .thenReturn(
            new ExecutionResponse(
                "pricing",
                3,
                new Engine.Result(result, trace, 1234, sources, true, true, 7, 321),
                new Timing(10, 1234, 1300)));

    mvc.perform(
            post("/api/preview").contentType(MediaType.APPLICATION_JSON).content("{\"inputs\":{}}"))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    "{\"ruleId\":\"pricing\",\"version\":3,"
                        + "\"result\":{\"total\":12.50,\"items\":[1,\"a\",true,null]},"
                        + "\"trace\":["
                        + "{\"ruleId\":\"pricing\",\"version\":3,\"nodeId\":\"calc\","
                        + "\"label\":\"Calc\",\"type\":\"FORMULA\",\"value\":12.50,"
                        + "\"branch\":\"next\",\"depth\":0},"
                        + "{\"ruleId\":\"child\",\"version\":1,\"nodeId\":\"out\","
                        + "\"label\":\"Out\",\"type\":\"OUTPUT\",\"value\":\"x\","
                        + "\"branch\":null,\"depth\":1}],"
                        + "\"durationMicros\":1234,"
                        + "\"sources\":[{\"input\":\"rate\",\"sourceId\":\"country-tax\","
                        + "\"version\":2,\"status\":\"DEFAULT\",\"durationMicros\":55}],"
                        + "\"traceEnabled\":true,\"traceTruncated\":true,"
                        + "\"executedSteps\":7,\"traceBytes\":321,"
                        + "\"timing\":{\"preparationMicros\":10,\"executionMicros\":1234,"
                        + "\"totalMicros\":1300}}"));
  }

  /**
   * Every error body has the documented fields in the documented order on every JVM: a graph error
   * with its locations, a 404 and the 400 for malformed JSON with empty issues and locations.
   */
  @Test
  void errorBodiesKeepTheDocumentedFieldOrder() throws Exception {
    when(rules.get("missing")).thenThrow(new ArcException(404, "Rule not found: missing"));
    mvc.perform(get("/api/rules/missing"))
        .andExpect(status().isNotFound())
        .andExpect(
            content()
                .string(
                    "{\"status\":404,\"message\":\"Rule not found: missing\","
                        + "\"issues\":[\"Rule not found: missing\"],\"locations\":[]}"));
    when(execution.preview(any()))
        .thenThrow(
            ArcException.invalid("Missing required input: amount")
                .atNode("preview", null, "input", "Inputs"));
    mvc.perform(
            post("/api/preview").contentType(MediaType.APPLICATION_JSON).content("{\"inputs\":{}}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(
            content()
                .string(
                    "{\"status\":422,\"message\":\"Missing required input: amount\","
                        + "\"issues\":[\"Missing required input: amount\"],"
                        + "\"locations\":[{\"ruleId\":\"preview\",\"version\":null,"
                        + "\"nodeId\":\"input\",\"label\":\"Inputs\"}]}"));
    mvc.perform(
            post("/api/preview").contentType(MediaType.APPLICATION_JSON).content("{\"inputs\":"))
        .andExpect(status().isBadRequest())
        .andExpect(
            content()
                .string(
                    "{\"status\":400,\"message\":\"Request contains malformed JSON or an invalid"
                        + " value\",\"issues\":[],\"locations\":[]}"));
  }

  @Test
  void graphJsonKeepsEveryStoredFieldAndNoDerivedProperty() throws Exception {
    when(rules.get("pricing")).thenReturn(rule(definition()));

    mvc.perform(get("/api/rules/pricing"))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    "{\"id\":\"pricing\",\"name\":\"Pricing\",\"description\":\"\","
                        + "\"kind\":\"DECISION_TREE\",\"draft\":"
                        + DEFINITION_JSON
                        + ",\"revision\":4,\"publishedVersion\":2,"
                        + "\"createdAt\":\"1970-01-01T00:00:00Z\","
                        + "\"updatedAt\":\"1970-01-01T00:00:00Z\"}"));
  }

  private static final String NULL_NODE_FIELDS =
      "\"ruleId\":null,\"version\":null,\"bindings\":null,\"cases\":null,\"fields\":null,"
          + "\"selector\":null,\"outputName\":null";

  private static final String DEFINITION_JSON =
      "{\"schemaVersion\":1,"
          + "\"inputs\":["
          + "{\"name\":\"amount\",\"type\":\"NUMBER\",\"required\":true,\"defaultValue\":100,"
          + "\"source\":null},"
          + "{\"name\":\"rate\",\"type\":\"NUMBER\",\"required\":false,\"defaultValue\":0.1,"
          + "\"source\":{\"id\":\"country-tax\",\"version\":2,\"bindings\":{\"key\":\"amount\"},"
          + "\"pointer\":\"/rate\",\"onError\":\"DEFAULT\"}}],"
          + "\"nodes\":["
          + "{\"id\":\"input\",\"type\":\"INPUT\",\"label\":\"Inputs\","
          + "\"position\":{\"x\":0.0,\"y\":0.0},\"expression\":null,\"output\":null,"
          + NULL_NODE_FIELDS
          + "},"
          + "{\"id\":\"calc\",\"type\":\"FORMULA\",\"label\":\"Calc\",\"position\":null,"
          + "\"expression\":\"amount * rate\",\"output\":\"discount\","
          + NULL_NODE_FIELDS
          + "},"
          + "{\"id\":\"check\",\"type\":\"CONDITION\",\"label\":\"Check\",\"position\":null,"
          + "\"expression\":\"discount > 5\",\"output\":null,"
          + NULL_NODE_FIELDS
          + "},"
          + "{\"id\":\"route\",\"type\":\"SWITCH\",\"label\":\"Route\","
          + "\"position\":{\"x\":10.5,\"y\":-20.0},\"expression\":null,\"output\":null,"
          + "\"ruleId\":null,\"version\":null,\"bindings\":null,"
          + "\"cases\":[{\"id\":\"big\",\"label\":\"Big\",\"expression\":\"100\"}],"
          + "\"fields\":null,\"selector\":\"amount\",\"outputName\":null},"
          + "{\"id\":\"shape\",\"type\":\"TRANSFORM\",\"label\":\"Shape\",\"position\":null,"
          + "\"expression\":null,\"output\":\"data\",\"ruleId\":null,\"version\":null,"
          + "\"bindings\":null,\"cases\":null,"
          + "\"fields\":[{\"name\":\"value\",\"expression\":\"amount\"}],"
          + "\"selector\":null,\"outputName\":null},"
          + "{\"id\":\"reuse\",\"type\":\"REFERENCE\",\"label\":\"Reuse\",\"position\":null,"
          + "\"expression\":null,\"output\":\"price\",\"ruleId\":\"apply-discount\","
          + "\"version\":1,\"bindings\":{\"amount\":\"amount\",\"rate\":\"0.2\"},"
          + "\"cases\":null,\"fields\":null,\"selector\":null,\"outputName\":null},"
          + "{\"id\":\"done\",\"type\":\"OUTPUT\",\"label\":\"Done\",\"position\":null,"
          + "\"expression\":\"price\",\"output\":null,\"ruleId\":null,\"version\":null,"
          + "\"bindings\":null,\"cases\":null,\"fields\":null,\"selector\":null,"
          + "\"outputName\":\"total\"}],"
          + "\"edges\":["
          + "{\"id\":\"input-next-calc\",\"source\":\"input\",\"target\":\"calc\","
          + "\"sourceHandle\":\"next\"},"
          + "{\"id\":\"route-case\",\"source\":\"route\",\"target\":\"shape\","
          + "\"sourceHandle\":\"case:big\"}],"
          + "\"notes\":[\"First note\"]}";

  /** One node of every kind, each with the fields its kind uses. */
  private static Definition definition() {
    var bindings = new LinkedHashMap<String, String>();
    bindings.put("amount", "amount");
    bindings.put("rate", "0.2");
    return new Definition(
        1,
        List.of(
            new Input("amount", "NUMBER", true, new BigDecimal("100")),
            new Input(
                "rate",
                "NUMBER",
                false,
                new BigDecimal("0.1"),
                new SourceBinding("country-tax", 2, Map.of("key", "amount"), "/rate", "DEFAULT"))),
        List.of(
            nodeOf("input", "INPUT", "Inputs").at(0, 0).build(),
            nodeOf("calc", "FORMULA", "Calc")
                .expression("amount * rate")
                .output("discount")
                .build(),
            nodeOf("check", "CONDITION", "Check").expression("discount > 5").build(),
            nodeOf("route", "SWITCH", "Route")
                .at(10.5, -20)
                .cases(List.of(new BranchCase("big", "Big", "100")))
                .selector("amount")
                .build(),
            nodeOf("shape", "TRANSFORM", "Shape")
                .output("data")
                .fields(List.of(new Field("value", "amount")))
                .build(),
            nodeOf("reuse", "REFERENCE", "Reuse")
                .output("price")
                .rule("apply-discount", 1)
                .bindings(bindings)
                .build(),
            nodeOf("done", "OUTPUT", "Done").expression("price").outputName("total").build()),
        List.of(
            new Edge("input-next-calc", "input", "calc", "next"),
            new Edge("route-case", "route", "shape", "case:big")),
        List.of("First note"));
  }

  private static Rule rule(Definition draft) {
    return new Rule(
        "pricing", "Pricing", "", "DECISION_TREE", draft, 4, 2, Instant.EPOCH, Instant.EPOCH);
  }
}
