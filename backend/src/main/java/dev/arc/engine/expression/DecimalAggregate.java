package dev.arc.engine.expression;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.List;

/**
 * Aggregates that ARC computes with decimal arithmetic instead of POI's floating point. Each name
 * owns its behavior here, so a listed aggregate without code cannot compile; the declaration order
 * is the catalog order.
 */
enum DecimalAggregate {
  SUM,
  MIN,
  MAX,
  AVG,
  AVERAGE,
  COUNT,
  MUL;

  /** Whether the aggregate has a value for no numbers at all: an empty sum, product or count. */
  boolean acceptsNoValues() {
    return switch (this) {
      case SUM, MUL, COUNT -> true;
      case MIN, MAX, AVG, AVERAGE -> false;
    };
  }

  BigDecimal apply(List<BigDecimal> numbers) {
    if (numbers.isEmpty() && !acceptsNoValues())
      throw ArcException.invalid(name() + " requires values");
    return switch (this) {
      case SUM -> sum(numbers);
      case MIN -> numbers.stream().min(BigDecimal::compareTo).orElseThrow();
      case MAX -> numbers.stream().max(BigDecimal::compareTo).orElseThrow();
      case AVG, AVERAGE ->
          sum(numbers).divide(BigDecimal.valueOf(numbers.size()), Expressions.MATH);
      case COUNT -> BigDecimal.valueOf(numbers.size());
      case MUL ->
          numbers.stream().reduce(BigDecimal.ONE, (a, b) -> a.multiply(b, Expressions.MATH));
    };
  }

  private static BigDecimal sum(List<BigDecimal> numbers) {
    return numbers.stream().reduce(BigDecimal.ZERO, (a, b) -> a.add(b, Expressions.MATH));
  }
}
