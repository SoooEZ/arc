package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.SourceReader;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ExecutionTraceTest {
  private final ObjectMapper json = new ObjectMapper();

  @Test
  void byteBudgetCountsEscapedUtf8AndKeepsWholePrefixSteps() throws Exception {
    var step = new Engine.Step("rule", 1, "one", "Quoted \"\n😀", "OUTPUT", "\\\t雪", null, 0);
    int bytes = json.writeValueAsBytes(List.of(step)).length;
    var trace = new ExecutionTrace(json, true, bytes);
    trace.add(step);
    assertThat(trace.bytes()).isEqualTo(bytes);
    assertThat(trace.steps()).containsExactly(step);
    assertThat(trace.truncated()).isFalse();
    trace.add(step);
    assertThat(trace.truncated()).isTrue();
    assertThat(trace.steps()).containsExactly(step);
    assertThat(trace.bytes()).isEqualTo(json.writeValueAsBytes(trace.steps()).length);
  }

  @Test
  void disablingOrTruncatingTracePreservesResultAndExecutedStepCount() {
    Definition graph = ExecutionPlansTest.graph("'" + "x".repeat(100) + "'");
    var engine = new Engine(new Validator(), json, 10);
    for (boolean enabled : List.of(true, false)) {
      var result =
          engine
              .session(
                  (id, v) -> {
                    throw new AssertionError();
                  },
                  ExecutionDeadline.start(30_000))
              .execute(
                  "preview",
                  null,
                  graph,
                  Map.of(),
                  new Parameters(SourceReader.unavailable()),
                  enabled);
      assertThat(result.result()).isEqualTo("x".repeat(100));
      assertThat(result.executedSteps()).isEqualTo(2);
      assertThat(result.trace()).isEmpty();
      assertThat(result.traceEnabled()).isEqualTo(enabled);
      assertThat(result.traceTruncated()).isEqualTo(enabled);
      assertThat(result.traceBytes()).isEqualTo(2);
    }
  }

  @Test
  void deadlineFailuresKeepTheirStatusThroughSwitchTransformAndFallbackExpressions() {
    for (String scenario :
        List.of("SWITCH", "SWITCH_SELECTOR", "SWITCH_VALUE", "TRANSFORM", "FORMULA")) {
      String type = scenario.startsWith("SWITCH") ? "SWITCH" : scenario;
      var deadline = ExecutionDeadline.start(100);
      Map<String, Object> payload =
          new HashMap<>(Map.of("value", true)) {
            @Override
            public Object get(Object key) {
              // Wait for this request's actual deadline without relying on an asserted elapsed
              // time.
              while (true) {
                java.util.concurrent.locks.LockSupport.parkNanos(
                    deadline.remainingMillis() * 1_000_000);
              }
            }
          };
      Node action =
          switch (type) {
            case "SWITCH" ->
                new Node(
                    "action",
                    type,
                    type,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    List.of(
                        new BranchCase(
                            "active",
                            "Active",
                            scenario.equals("SWITCH_SELECTOR") ? "true" : "payload.value")),
                    null,
                    switch (scenario) {
                      case "SWITCH_SELECTOR" -> "payload.value";
                      case "SWITCH_VALUE" -> "true";
                      default -> null;
                    });
            case "TRANSFORM" ->
                new Node(
                    "action",
                    type,
                    type,
                    null,
                    null,
                    "result",
                    null,
                    null,
                    null,
                    null,
                    List.of(new Field("value", "payload.value")));
            default ->
                new Node(
                    "action",
                    type,
                    type,
                    null,
                    "$IFERROR(payload.value, 9)",
                    "result",
                    null,
                    null,
                    null);
          };
      var edges = new ArrayList<Edge>();
      edges.add(new Edge("start", "in", "action", "next"));
      if (type.equals("SWITCH")) {
        edges.add(new Edge("case", "action", "out", "case:active"));
        edges.add(new Edge("default", "action", "out", "default"));
      } else edges.add(new Edge("next", "action", "out", "next"));
      Definition graph =
          new Definition(
              1,
              List.of(new Input("payload", "OBJECT", true, null)),
              List.of(
                  ExecutionPlansTest.graph("1").nodes().getFirst(),
                  action,
                  ExecutionPlansTest.graph("1").nodes().getLast()),
              edges);
      var engine = new Engine(new Validator(), json);
      assertThatThrownBy(
              () ->
                  engine
                      .session(
                          (id, v) -> {
                            throw new AssertionError();
                          },
                          deadline)
                      .execute(
                          "preview",
                          null,
                          graph,
                          Map.of("payload", payload),
                          new Parameters(SourceReader.unavailable()),
                          false))
          .isInstanceOfSatisfying(
              ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
    }
  }

  @Test
  void nestedExecutionStillEnforcesStepBudgetWithoutRetainedTrace() {
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    nodes.add(new Node("in", "INPUT", "Input", null, null, null, null, null, null));
    String prior = "in";
    for (int i = 0; i < 98; i++) {
      String id = "n" + i;
      nodes.add(new Node(id, "FORMULA", id, null, "1", "v" + i, null, null, null));
      edges.add(new Edge(id, prior, id, "next"));
      prior = id;
    }
    nodes.add(new Node("out", "OUTPUT", "Output", null, "1", null, null, null, null));
    edges.add(new Edge("last", prior, "out", "next"));
    Definition child = new Definition(1, List.of(), nodes, edges);
    var parentNodes = new ArrayList<Node>();
    var parentEdges = new ArrayList<Edge>();
    parentNodes.add(nodes.getFirst());
    prior = "in";
    for (int i = 0; i < 11; i++) {
      String id = "r" + i;
      parentNodes.add(new Node(id, "REFERENCE", id, null, null, "v" + i, "child", 1, Map.of()));
      parentEdges.add(new Edge(id, prior, id, "next"));
      prior = id;
    }
    parentNodes.add(nodes.getLast());
    parentEdges.add(new Edge("last", prior, "out", "next"));
    Definition parent = new Definition(1, List.of(), parentNodes, parentEdges);
    for (boolean enabled : List.of(true, false)) {
      var engine = new Engine(new Validator(), json, 10);
      assertThatThrownBy(
              () ->
                  engine
                      .session((id, v) -> child, ExecutionDeadline.start(30_000))
                      .execute(
                          "preview",
                          null,
                          parent,
                          Map.of(),
                          new Parameters(SourceReader.unavailable()),
                          enabled))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("1,000 steps");
    }
  }
}
