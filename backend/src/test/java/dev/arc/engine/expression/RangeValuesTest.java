package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** One evaluation converts a repeated range once, without keeping every list it converted. */
class RangeValuesTest {
  @Test
  void aRepeatedRangeConvertsOnceAndFreshListsDoNotAccumulate() {
    var ranges = new RangeValues();
    List<Object> table = List.of(BigDecimal.ONE, BigDecimal.TWO);
    assertThat(ranges.value(table)).isSameAs(ranges.value(table));
    // Each $MAP item can build fresh lists ($MMULT(col, row)), which never repeat; the memo kept
    // them all until the expression finished: 682 MB for 1,000 items of a 9,801-cell product.
    for (int item = 0; item < 1_000; item++) {
      ranges.value(new ArrayList<Object>(List.of(BigDecimal.valueOf(item))));
      ranges.value(table);
    }
    assertThat(ranges.retained()).isLessThanOrEqualTo(RangeValues.CAPACITY);
    // The table that every item looks values up in stayed converted throughout.
    var converted = ranges.value(table);
    assertThat(ranges.value(table)).isSameAs(converted);
  }
}
