package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ExpressionSyntaxTest {
  @Test
  void longStringLiteralsCompileOnASmallThreadStack() throws InterruptedException {
    // 1,998 characters is the longest literal an expression can hold. The old token pattern
    // recursed once per character and overflowed small stacks with a StackOverflowError (500).
    var literals =
        List.of(
            "\"" + "x".repeat(1998) + "\"",
            "'" + "x".repeat(1998) + "'",
            "\"" + "\\\"".repeat(999) + "\"",
            "'" + "a\\n".repeat(666) + "'");
    for (String literal : literals) {
      var result = new AtomicReference<Object>();
      var thread =
          new Thread(
              null,
              () -> {
                try {
                  result.set(Expressions.evaluate(literal, Map.of()));
                } catch (Throwable failure) {
                  result.set(failure);
                }
              },
              "small-stack",
              256 * 1024);
      thread.start();
      thread.join();
      assertThat(result.get()).as(literal.substring(0, 12)).isInstanceOf(String.class);
    }
    assertThat(Expressions.evaluate("\"" + "\\\"".repeat(999) + "\"", Map.of()))
        .isEqualTo("\"".repeat(999));
    assertThatThrownBy(() -> Expressions.compile("\"unterminated \\\""))
        .isInstanceOf(ArcException.class)
        .hasMessage("Invalid expression near character 1");
  }

  @Test
  void variablesAreReportedInSourceOrder() {
    // Callers resolve and read dependencies in this order; a hash-ordered set varied per JVM.
    assertThat(Expressions.compile("e + d + c + b + a").variables())
        .containsExactly("e", "d", "c", "b", "a");
    assertThat(
            Expressions.compile("$SUM($MAP(zeta, x, x + alpha)) + beta.value + zeta + alpha")
                .variables())
        .containsExactly("zeta", "alpha", "beta");
    var variables = Expressions.compile("b + a").variables();
    assertThatThrownBy(() -> variables.add("c")).isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void propertyPathsNeedANameAfterEveryDot() {
    // "customer." used to read a field named "" and quietly return null.
    for (String path : List.of("customer.", "customer..name", "items.0.")) {
      assertThatThrownBy(() -> Expressions.compile(path))
          .as(path)
          .isInstanceOf(ArcException.class)
          .hasMessage("Property path needs a name after every '.': " + path);
    }
    var customer = Map.<String, Object>of("customer", Map.of("name", "Ada"));
    assertThat(Expressions.evaluate("customer.name", customer)).isEqualTo("Ada");
    assertThat(Expressions.evaluate("customer.missing", customer)).isNull();
  }
}
