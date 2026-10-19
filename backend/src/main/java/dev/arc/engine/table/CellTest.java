package dev.arc.engine.table;

import dev.arc.engine.expression.Expressions;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * One condition cell of a decision table, parsed ({@link DecisionTables#test}): whether a column
 * value passes it. Equality follows ARC's {@code ==}: the same type, numbers by decimal value, text
 * exactly. Comparisons and ranges take numbers only; a null value never passes them, and a value of
 * another type fails the run ({@link Mismatch}), as {@code <} does.
 */
public sealed interface CellTest {
  boolean holds(Object value);

  /** The values the test names, in order, for the rule that one column tests one type. */
  List<Object> literals();

  /** {@code -}: every value passes, null too. */
  record Any() implements CellTest {
    @Override
    public boolean holds(Object value) {
      return true;
    }

    @Override
    public List<Object> literals() {
      return List.of();
    }
  }

  /** A value: {@code "gold"}, {@code 100}, {@code true} or {@code null}. */
  record Equal(Object literal) implements CellTest {
    @Override
    public boolean holds(Object value) {
      return Expressions.equal(value, literal);
    }

    @Override
    public List<Object> literals() {
      return listOf(literal);
    }
  }

  /** {@code != value}: values of another type are never equal, so they pass. */
  record NotEqual(Object literal) implements CellTest {
    @Override
    public boolean holds(Object value) {
      return !Expressions.equal(value, literal);
    }

    @Override
    public List<Object> literals() {
      return listOf(literal);
    }
  }

  /** {@code < n}, {@code <= n}, {@code > n} or {@code >= n}. */
  record Compare(Operator operator, BigDecimal bound) implements CellTest {
    /** The comparison of a value with the bound. */
    public enum Operator {
      LESS,
      LESS_OR_EQUAL,
      GREATER,
      GREATER_OR_EQUAL
    }

    @Override
    public boolean holds(Object value) {
      if (value == null) return false;
      int order = Mismatch.ordered(value, bound);
      return switch (operator) {
        case LESS -> order < 0;
        case LESS_OR_EQUAL -> order <= 0;
        case GREATER -> order > 0;
        case GREATER_OR_EQUAL -> order >= 0;
      };
    }

    @Override
    public List<Object> literals() {
      return List.of(bound);
    }
  }

  /**
   * {@code low..high}; {@code <} beside the dots leaves that end out: {@code 10..<20} holds for 10
   * up to but not including 20.
   */
  record Range(BigDecimal low, boolean lowIncluded, BigDecimal high, boolean highIncluded)
      implements CellTest {
    @Override
    public boolean holds(Object value) {
      if (value == null) return false;
      int fromLow = Mismatch.ordered(value, low);
      int fromHigh = Mismatch.ordered(value, high);
      return (lowIncluded ? fromLow >= 0 : fromLow > 0)
          && (highIncluded ? fromHigh <= 0 : fromHigh < 0);
    }

    @Override
    public List<Object> literals() {
      return List.of(low, high);
    }
  }

  /** {@code a, b, …}: passes when one of the tests does, checked in order. */
  record AnyOf(List<CellTest> tests) implements CellTest {
    public AnyOf {
      tests = List.copyOf(tests);
    }

    @Override
    public boolean holds(Object value) {
      for (CellTest test : tests) if (test.holds(value)) return true;
      return false;
    }

    @Override
    public List<Object> literals() {
      return joined(tests);
    }
  }

  /** {@code not(a, b, …)}: passes when none of the tests does. */
  record NoneOf(List<CellTest> tests) implements CellTest {
    public NoneOf {
      tests = List.copyOf(tests);
    }

    @Override
    public boolean holds(Object value) {
      for (CellTest test : tests) if (test.holds(value)) return false;
      return true;
    }

    @Override
    public List<Object> literals() {
      return joined(tests);
    }
  }

  /** A list that may hold null, which {@code List.of} refuses. */
  private static List<Object> listOf(Object literal) {
    var literals = new ArrayList<Object>(1);
    literals.add(literal);
    return literals;
  }

  private static List<Object> joined(List<CellTest> tests) {
    var literals = new ArrayList<Object>();
    for (CellTest test : tests) literals.addAll(test.literals());
    return literals;
  }

  /**
   * A comparison or range test met a value that is not a number. Matching names the column, the
   * value and the row in the run's error ({@link DecisionTables.Compiled#select}).
   */
  final class Mismatch extends RuntimeException {
    private Mismatch() {
      super(null, null, false, false);
    }

    /** The order of a number value relative to a bound; any other value is a mismatch. */
    static int ordered(Object value, BigDecimal bound) {
      if (!(value instanceof Number)) throw new Mismatch();
      return Expressions.compareNumbers(value, bound);
    }
  }
}
