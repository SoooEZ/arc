package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.edge;
import static dev.arc.support.GraphFixtures.node;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * A value error keeps its 422 when it arrives after the deadline, wherever its expression sits: the
 * same request then fails the same way on a slower host. A source mapping answered 504 for such an
 * error, while a Formula node or an Output answered 422.
 */
class LateFailureTest {
  private final Engine engine = new Engine(new Validator());
  private final RuleResolver noRules =
      (id, version) -> {
        throw new IllegalStateException("no references");
      };

  @Test
  void aValueErrorAfterTheDeadlineStaysAValueErrorInEveryExpressionPosition() {
    var payload = new Input("payload", "OBJECT", true, null);
    var rate =
        new Input(
            "rate",
            "NUMBER",
            true,
            null,
            new SourceBinding("rates", 1, Map.of("key", "payload.value"), null, "FAIL"));
    var input = node("input", "INPUT", null, null);
    var graphs = new LinkedHashMap<String, Definition>();
    graphs.put(
        "Formula node",
        new Definition(
            1,
            List.of(payload),
            List.of(
                input,
                node("f", "FORMULA", "payload.value", "r"),
                node("out", "OUTPUT", "r", null)),
            List.of(edge("input", "f", "next"), edge("f", "out", "next"))));
    graphs.put(
        "Output",
        new Definition(
            1,
            List.of(payload),
            List.of(input, node("out", "OUTPUT", "payload.value", null)),
            List.of(edge("input", "out", "next"))));
    graphs.put(
        "Source mapping",
        new Definition(
            1,
            List.of(payload, rate),
            List.of(input, node("out", "OUTPUT", "rate", null)),
            List.of(edge("input", "out", "next"))));

    for (var graph : graphs.entrySet()) {
      var deadline = ExecutionDeadline.start(ExecutionDeadline.MIN_TIMEOUT_MS);
      assertThatThrownBy(
              () ->
                  engine
                      .session(noRules, deadline)
                      .execute(
                          "late",
                          null,
                          graph::getValue,
                          Map.of("payload", failingAfter(deadline)),
                          new Parameters((binding, inputs, readDeadline) -> 1),
                          false))
          .as(graph.getKey())
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> assertThat(error.kind()).isEqualTo(ArcException.Kind.INVALID))
          .hasMessageEndingWith("late value error");
    }
  }

  /** An object whose field read waits for the deadline to pass, then fails with a value error. */
  private static Map<String, Object> failingAfter(ExecutionDeadline deadline) {
    return new HashMap<>(Map.of("value", true)) {
      @Override
      public Object get(Object key) {
        while (true) {
          try {
            deadline.check();
            Thread.sleep(1);
          } catch (ArcException expired) {
            throw ArcException.invalid("late value error");
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
          }
        }
      }
    };
  }
}
