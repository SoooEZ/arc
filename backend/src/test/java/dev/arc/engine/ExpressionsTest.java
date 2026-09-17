package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.api.ArcException;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ExpressionsTest {
  private Object eval(String expression) {
    return Expressions.evaluate(expression, Map.of());
  }

  @Test
  void arithmeticIsDecimalAndRespectsPrecedence() {
    assertThat(eval("0.1 + 0.2")).isEqualTo(new BigDecimal("0.3"));
    assertThat(eval("2 + 3 * 4")).isEqualTo(new BigDecimal("14"));
    assertThat(eval("(2 + 3) * -4")).isEqualTo(new BigDecimal("-20"));
    assertThat(eval("10 % 3")).isEqualTo(new BigDecimal("1"));
  }

  @Test
  void roundingAndFunctionsAreDeterministic() {
    assertThat(eval("round(19.995, 2)")).isEqualTo(new BigDecimal("20.00"));
    assertThat(eval("max(2, min(10, 5)) + abs(-3)")).isEqualTo(new BigDecimal("8"));
    assertThat(eval("ceil(2.1) + floor(2.9)")).isEqualTo(new BigDecimal("5"));
  }

  @Test
  void logicalOperatorsShortCircuit() {
    assertThat(eval("false && 1 / 0 > 0")).isEqualTo(false);
    assertThat(eval("true || 1 / 0 > 0")).isEqualTo(true);
    assertThat(eval("if(true, 42, 1 / 0)")).isEqualTo(new BigDecimal("42"));
    assertThat(eval("!false && (1 == 1.0) && (2 <= 3)")).isEqualTo(true);
  }

  @Test
  void stringsAndInputs() {
    assertThat(
            Expressions.evaluate("customerTier == \"premium\"", Map.of("customerTier", "premium")))
        .isEqualTo(true);
    assertThat(eval("'hello' != 'world'")).isEqualTo(true);
    assertThat(eval("\"hello\\nworld\"")).isEqualTo("hello\nworld");
    assertThat(Expressions.compile("amount * (1 - rate)").variables())
        .containsExactlyInAnyOrder("amount", "rate");
  }

  @Test
  void invalidExpressionsFailClearly() {
    assertThatThrownBy(() -> eval("1 / 0")).hasMessageContaining("Division by zero");
    assertThatThrownBy(() -> eval("missing + 1")).hasMessageContaining("Unknown variable");
    assertThatThrownBy(() -> eval("1 +")).hasMessageContaining("Incomplete expression");
    assertThatThrownBy(() -> eval("round(1, 99)")).hasMessageContaining("-12 to 12");
    assertThatThrownBy(() -> eval("round(1, 0.5)")).hasMessageContaining("integer");
    assertThatThrownBy(() -> eval("max()")).hasMessageContaining("argument count");
    assertThatThrownBy(() -> eval("true + 1")).hasMessageContaining("Expected a number");
  }

  @Test
  void inverseRejectsSingularMatrices() {
    assertThatThrownBy(() -> eval("MINVERSE([[1,2],[2,4]])"))
        .isInstanceOf(ArcException.class).hasMessage("MINVERSE: #NUM!");
  }

  @Test
  void arbitraryCodeAndExcessiveWorkAreRejected() {
    for (String expression :
        new String[] {
          "Runtime.getRuntime()",
          "new ProcessBuilder()",
          "T(java.lang.Runtime)",
          "system('whoami')",
          "1e9999",
          "1 + ".repeat(200) + "1",
          "(".repeat(60) + "1" + ")".repeat(60)
        }) {
      assertThatThrownBy(() -> eval(expression)).as(expression).isInstanceOf(ArcException.class);
    }
  }
}
