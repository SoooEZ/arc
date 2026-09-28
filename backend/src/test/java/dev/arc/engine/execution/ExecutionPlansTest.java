package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.CompiledGraph;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ExecutionPlansTest {
  private final ObjectMapper json = new ObjectMapper();
  private final RuleResolver noReferences =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  private static class CountingValidator extends Validator {
    int compilations;

    @Override
    public CompiledGraph compile(Definition definition, RuleResolver resolver) {
      compilations++;
      return super.compile(definition, resolver);
    }
  }

  static Definition graph(String expression) {
    return new Definition(
        1,
        List.of(),
        List.of(inputNode("in", "Input"), outputNode("out", "Output", expression)),
        List.of(new Edge("edge", "in", "out", "next")));
  }

  private ExecutionPlans.Session session(ExecutionPlans plans) {
    return plans.session(noReferences, ExecutionDeadline.start(30_000), true);
  }

  @Test
  void preparedGraphReusesItsCompiledExpressionsAndDraftsStayRequestLocal() {
    var validator = new CountingValidator();
    var plans = new ExecutionPlans(validator, json);
    Definition draft = graph("1 + 2");
    var first = session(plans);
    var prepared = first.prepare("preview", null, () -> draft);
    assertThat(first.prepare("preview", null, () -> draft)).isSameAs(prepared);
    assertThat(prepared.expression("1 + 2")).isSameAs(prepared.expression("1 + 2"));
    session(plans).prepare("preview", null, () -> draft);
    assertThat(validator.compilations).isEqualTo(2);
  }

  @Test
  void publishedPinsAreVersionedAndDoNotRetainMutableCallerCollections() {
    var validator = new CountingValidator();
    var plans = new ExecutionPlans(validator, json);
    var nodes = new ArrayList<>(graph("1").nodes());
    Definition original = new Definition(1, List.of(), nodes, graph("1").edges());
    var first = session(plans).prepare("rule", 1, () -> original);
    nodes.set(1, graph("2").nodes().get(1));
    assertThat(session(plans).prepare("rule", 1, () -> original)).isSameAs(first);
    assertThat(first.expression("1").evaluate(Map.of())).isEqualTo(new java.math.BigDecimal("1"));
    assertThatThrownBy(() -> first.definition().nodes().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    session(plans).prepare("rule", 2, () -> original);
    assertThat(validator.compilations).isEqualTo(2);
  }

  @Test
  void everyStoredFieldCountsTowardsAPlansWeight() {
    var plans = new ExecutionPlans(new CountingValidator(), json, 10, 12_000);
    var plain = graph("1");
    var inputs = new ArrayList<Input>();
    for (int index = 0; index < 20; index++)
      inputs.add(
          new Input(
              "p" + index,
              "NUMBER",
              false,
              null,
              new SourceBinding("rates", 1, Map.of(), "/" + "x".repeat(480), "FAIL")));
    var pointers = new Definition(1, inputs, plain.nodes(), plain.edges());
    assertThat(session(plans).prepare("plain", 1, () -> plain))
        .isSameAs(session(plans).prepare("plain", 1, () -> plain));
    assertThat(session(plans).prepare("pointers", 1, () -> pointers))
        .isNotSameAs(session(plans).prepare("pointers", 1, () -> pointers));
  }

  @Test
  void entryAndWeightBoundsEvictPlansAndOversizedPlansAreNotCached() {
    for (ExecutionPlans plans :
        List.of(
            new ExecutionPlans(new CountingValidator(), json, 1, 1_000_000),
            new ExecutionPlans(new CountingValidator(), json, 10, 8_000))) {
      var first = session(plans).prepare("a", 1, () -> graph("1"));
      session(plans).prepare("b", 1, () -> graph("2"));
      assertThat(session(plans).prepare("a", 1, () -> graph("1"))).isNotSameAs(first);
    }
    var tiny = new ExecutionPlans(new CountingValidator(), json, 10, 1);
    assertThat(session(tiny).prepare("a", 1, () -> graph("1")))
        .isNotSameAs(session(tiny).prepare("a", 1, () -> graph("1")));
  }
}
