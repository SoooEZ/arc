package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
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

  /**
   * A published plan keeps the verdict of its contract check until its rule is forgotten; a draft
   * and a session that started before a deletion never store one.
   */
  @Test
  void aVerdictLastsAsLongAsItsCachedPlan() {
    var plans = new ExecutionPlans(new Validator(), json);
    var checks = new int[1];
    Runnable check = () -> checks[0]++;
    for (int request = 0; request < 3; request++) {
      var session = session(plans);
      session.prepare("rule", 1, () -> graph("1"));
      session.verifyOnce("rule", 1, check);
      session.verifyOnce("preview", null, check);
    }
    assertThat(checks[0]).isEqualTo(1 + 3);

    var beforeDeletion = session(plans);
    plans.forget("rule");
    beforeDeletion.prepare("rule", 1, () -> graph("2"));
    beforeDeletion.verifyOnce("rule", 1, check);
    var afterDeletion = session(plans);
    afterDeletion.prepare("rule", 1, () -> graph("2"));
    afterDeletion.verifyOnce("rule", 1, check);
    afterDeletion.verifyOnce("rule", 1, check);
    assertThat(checks[0]).isEqualTo(4 + 2);
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

  /**
   * A deleted rule's ID may name a different rule later, so none of its plans may survive: neither
   * a cached one nor one that a request which began before the deletion compiles afterwards.
   */
  @Test
  void forgettingARuleDropsItsPlansAndEarlierRequestsCannotCacheThemAgain() {
    var plans = new ExecutionPlans(new CountingValidator(), json);
    var kept = session(plans).prepare("kept", 1, () -> graph("1"));
    session(plans).prepare("deleted", 1, () -> graph("2"));
    var beganBeforeDeletion = session(plans);

    plans.forget("deleted");
    // This request read the rule before the deletion committed.
    beganBeforeDeletion.prepare("deleted", 1, () -> graph("3"));

    var recreated = session(plans).prepare("deleted", 1, () -> graph("4"));
    assertThat(recreated.expressions()).containsOnlyKeys("4");
    assertThat(session(plans).prepare("kept", 1, () -> graph("1"))).isSameAs(kept);
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

  /**
   * A chain of 40 Formulas holds 820 scope entries, and 2,920 with 50 inputs: the inputs weighed
   * only their JSON, so the larger plan fit a bound it exceeds by far.
   */
  @Test
  void theVariablesInEveryNodesScopeCountTowardsAPlansWeight() {
    var plans = new ExecutionPlans(new CountingValidator(), json, 10, 150_000);
    var narrow = chain(40, 0);
    var wide = chain(40, 50);
    assertThat(session(plans).prepare("narrow", 1, () -> narrow))
        .isSameAs(session(plans).prepare("narrow", 1, () -> narrow));
    assertThat(session(plans).prepare("wide", 1, () -> wide))
        .isNotSameAs(session(plans).prepare("wide", 1, () -> wide));
  }

  /** Input, a chain of Formulas each storing a result, and an Output, with optional inputs. */
  private static Definition chain(int formulas, int inputs) {
    var declared = new ArrayList<Input>();
    for (int index = 0; index < inputs; index++)
      declared.add(new Input("p" + index, "NUMBER", false, null));
    var nodes = new ArrayList<Node>(List.of(inputNode("in", "Input")));
    var edges = new ArrayList<Edge>();
    String previous = "in";
    for (int index = 0; index < formulas; index++) {
      String id = "f" + index;
      nodes.add(nodeOf(id, "FORMULA", "F" + index).expression("1").output("r" + index).build());
      edges.add(new Edge("e" + index, previous, id, "next"));
      previous = id;
    }
    nodes.add(outputNode("out", "Output", "1"));
    edges.add(new Edge("last", previous, "out", "next"));
    return new Definition(1, declared, nodes, edges);
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
