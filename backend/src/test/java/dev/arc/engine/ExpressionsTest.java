package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
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

  @Test
  void decimalFailuresRemainCatchableExpressionErrors() {
    assertThatThrownBy(() -> eval("1e40 % 3"))
        .isInstanceOf(ArcException.class)
        .hasMessageContaining("Decimal operation");
    assertThat(eval("IFERROR(1e40 % 3, 7)")).isEqualTo(new BigDecimal("7"));
  }

  @Test
  void roundingRejectsIntegerMinimumPrecisionWithoutOverflow() {
    for (String function : new String[] {"ROUND", "ROUNDDOWN", "ROUNDUP"}) {
      assertThatThrownBy(() -> eval(function + "(1, -2147483648)"))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("-12 to 12");
    }
  }

  @Test
  void jsonEncodedStringConstantsPreserveTheirCharacters() throws Exception {
    String original = "control:\b\f" + (char) 0 + "\n\t\r quote:\" slash:\\ 中文";
    String literal = new ObjectMapper().writeValueAsString(original);
    assertThat(eval(literal)).isEqualTo(original);
    assertThat(eval("\"\\u4e2d\\u6587\\uD83D\\uDE00\"")).isEqualTo("中文😀");
    assertThat(eval("'it\\'s \\u0041\\b\\f'")).isEqualTo("it's A\b\f");
  }

  @Test
  void malformedUnicodeEscapesAreExpressionErrors() {
    for (String literal : new String[] {"\"\\u12\"", "\"\\uZZZZ\"", "'\\u-123'"}) {
      assertThatThrownBy(() -> eval(literal))
          .isInstanceOf(ArcException.class)
          .hasMessageContaining("Unicode escape");
    }
  }
}
