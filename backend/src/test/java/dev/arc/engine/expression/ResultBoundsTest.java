package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.Limits;
import java.math.BigDecimal;
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
