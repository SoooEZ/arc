package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.InputTypes;
import dev.arc.engine.Limits;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * An evaluation bounds its result once. A list literal, a collection function or a function that is
 * not lazy bounds what it returns, and the evaluation used to walk that result again.
 */
class ResultBoundsTest {
  /** Counts the walks of a value: ValueBounds reads a map through entrySet(). */
  private static final class CountingMap extends LinkedHashMap<String, Object> {
    int walks;

    @Override
    public Set<Map.Entry<String, Object>> entrySet() {
      walks++;
      return super.entrySet();
    }
  }

  @Test
  void aResultTheRuntimeBoundedIsNotWalkedAgain() {
    for (String expression :
        List.of(
            "$MAP(items, x, x)", "$FILTER(items, x, true)", "[item]", "$GET(holder, \"item\")")) {
      var item = new CountingMap();
      item.put("n", BigDecimal.ONE);
      Expressions.compile(expression)
          .evaluate(Map.of("items", List.of(item), "item", item, "holder", Map.of("item", item)));
      assertThat(item.walks).as(expression).isEqualTo(1);
    }
  }

  /**
   * Operators read their operands without bounding them again: every number an expression holds
   * entered through a bound. Each entry point refuses a number out of range, so the invariant holds
   * for literals, converted text, typed inputs (collection items included) and every operator and
   * function result; sources and Formula calls bound theirs in Parameters and the graph session.
   */
  @Test
  void everyEntryPointBoundsItsNumbersSoOperandsAreNotBoundedAgain() {
    String outOfRange = "Number exceeds supported precision or magnitude";
    var tooLarge = new BigDecimal("1E+" + (Limits.MAX_NUMBER_SCALE + 1));
    var hugeInteger = new BigInteger("1" + "0".repeat(Limits.MAX_NUMBER_PRECISION + 1));
    assertThatThrownBy(() -> Expressions.compile(tooLarge.toString())).hasMessage(outOfRange);
    assertThatThrownBy(() -> Expressions.evaluate("$TO_NUMBER(\"1E+101\")", Map.of()))
        .hasMessage(outOfRange);
    assertThatThrownBy(() -> InputTypes.check("amount", "NUMBER", tooLarge)).hasMessage(outOfRange);
    assertThatThrownBy(() -> InputTypes.check("items", "ARRAY", List.of(hugeInteger)))
        .hasMessage(outOfRange);
    assertThatThrownBy(() -> InputTypes.check("item", "OBJECT", Map.of("n", tooLarge)))
        .hasMessage(outOfRange);
    assertThatThrownBy(() -> Expressions.evaluate("1E+99 * 1E+99", Map.of()))
        .hasMessage(outOfRange);
    assertThatThrownBy(() -> Expressions.evaluate("$POWER(10, 200)", Map.of()))
        .hasMessage(outOfRange);
    assertThatThrownBy(() -> Expressions.evaluate("$SUM([1E+100, 9E+100])", Map.of()))
        .hasMessage(outOfRange);
    // A value an entry point bounded is read as it is: JSON integers inside a collection input
    // arrive as Integer, Long or BigInteger and are converted when an operator reads them.
    var items = InputTypes.check("items", "ARRAY", List.of(1, 2L, new BigInteger("3")));
    assertThat(Expressions.evaluate("$SUM($MAP(items, x, x * 2))", Map.of("items", items)))
        .isEqualTo(new BigDecimal("12"));
    assertThat(Expressions.evaluate("$GET(items, 0) < $GET(items, 2)", Map.of("items", items)))
        .isEqualTo(true);
  }

  /** Variables, lazy functions and Formula calls pass a value through; the evaluation bounds it. */
  @Test
  void aValueAnExpressionPassesThroughIsStillBounded() {
    Object deep = BigDecimal.ONE;
    for (int level = 0; level <= Limits.MAX_VALUE_DEPTH; level++) deep = List.of(deep);
    for (String expression :
        List.of(
            "value",
            "(value)",
            "$IF(true, value, null)",
            "$COALESCE(value, 0)",
            "$IFERROR(value, 0)",
            "$CHOOSE(1, value)",
            "[value]",
            "$MAP([1], x, value)")) {
      var scope = Map.of("value", deep);
      assertThatThrownBy(() -> Expressions.evaluate(expression, scope))
          .as(expression)
          .hasMessage("Value exceeds collection depth or size limit");
    }
  }
}
