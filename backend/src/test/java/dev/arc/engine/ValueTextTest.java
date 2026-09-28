package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class ValueTextTest {
  private static Map<Object, String> textCases() {
    var cases = new LinkedHashMap<Object, String>();
    cases.put(new BigDecimal("1E+3"), "1000");
    cases.put(new BigDecimal("1.2E+3"), "1200");
    cases.put(new BigDecimal("20.0"), "20.0");
    cases.put(new BigDecimal("0.000"), "0.000");
    cases.put(new BigDecimal("-0"), "0");
    cases.put(new BigDecimal("1E-7"), "0.0000001");
    cases.put(new BigDecimal("-1.50"), "-1.50");
    cases.put(42, "42");
    cases.put(7L, "7");
    cases.put("1E+3", "1E+3");
    cases.put("", "");
    cases.put(true, "true");
    cases.put(false, "false");
    return cases;
  }

  @Test
  void textIsThePlainDecimalToStringConversion() {
    for (var entry : textCases().entrySet()) {
      assertThat(ValueText.text(entry.getKey()))
          .as(entry.getKey().toString())
          .isEqualTo(entry.getValue());
    }
    assertThat(ValueText.text(null)).isNull();
  }

  @Test
  void toStringDelegatesWithoutChangingItsOutputOrErrors() {
    for (var entry : textCases().entrySet()) {
      Object value = Expressions.evaluate("$TO_STRING(value)", Map.of("value", entry.getKey()));
      assertThat(value).as(entry.getKey().toString()).isEqualTo(entry.getValue());
    }
    var nothing = new HashMap<String, Object>();
    nothing.put("value", null);
    assertThat(Expressions.evaluate("$TO_STRING(value)", nothing)).isNull();
    for (Object structured : List.of(List.of(1), Map.of("a", 1))) {
      assertThatThrownBy(
              () -> Expressions.evaluate("$TO_STRING(value)", Map.of("value", structured)))
          .hasMessage("TO_STRING expects a scalar value");
    }
  }

  @Test
  void keysIdentifyEqualNumbersWithOneCanonicalText() {
    var cases = new LinkedHashMap<Object, String>();
    cases.put(new BigDecimal("1E+3"), "1000");
    cases.put(new BigDecimal("1000"), "1000");
    cases.put(new BigDecimal("1000.0"), "1000");
    cases.put(1000, "1000");
    cases.put(new BigDecimal("20.0"), "20");
    cases.put(new BigDecimal("1.2E+3"), "1200");
    cases.put(new BigDecimal("0.000"), "0");
    cases.put(new BigDecimal("-0"), "0");
    cases.put(new BigDecimal("-0.00"), "0");
    cases.put(new BigDecimal("1E-7"), "0.0000001");
    cases.put(new BigDecimal("-1.50"), "-1.5");
    cases.put("1E+3", "1E+3");
    cases.put("20.0", "20.0");
    cases.put(true, "true");
    for (var entry : cases.entrySet()) {
      assertThat(ValueText.key(entry.getKey()))
          .as(entry.getKey().toString())
          .isEqualTo(entry.getValue());
    }
    assertThat(ValueText.key(null)).isNull();
  }

  @Test
  void onlyScalarsHaveText() {
    assertThat(ValueText.isScalar(null)).isTrue();
    assertThat(ValueText.isScalar("x")).isTrue();
    assertThat(ValueText.isScalar(BigDecimal.ONE)).isTrue();
    assertThat(ValueText.isScalar(false)).isTrue();
    for (Object structured : List.of(List.of(1), Map.of("a", 1))) {
      assertThat(ValueText.isScalar(structured)).isFalse();
      assertThatThrownBy(() -> ValueText.text(structured))
          .isInstanceOf(ArcException.class)
          .hasMessage("Expected a scalar value");
      assertThatThrownBy(() -> ValueText.key(structured))
          .isInstanceOf(ArcException.class)
          .hasMessage("Expected a scalar value");
    }
  }

  @Test
  void numbersKeepTheValueBounds() {
    var tooLarge = new BigDecimal("1E+101");
    assertThatThrownBy(() -> ValueText.text(tooLarge))
        .hasMessage("Number exceeds supported precision or magnitude");
    assertThatThrownBy(() -> ValueText.key(tooLarge))
        .hasMessage("Number exceeds supported precision or magnitude");
  }
}
