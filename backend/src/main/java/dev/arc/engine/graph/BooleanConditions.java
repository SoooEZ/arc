package dev.arc.engine.graph;

import dev.arc.error.ArcException;
import java.util.*;

// Reduced ordered Boolean decision diagrams avoid enumerating every combination
// of conditions. Each condition is independent: validation never assumes its value.
final class BooleanConditions {
  /**
   * Decision branches one analysis may build, and Boolean operations it may cache. The caps bound
   * the work of one test order; {@code engine.graph} imports no root contract, so they live here
   * rather than in {@code Limits}, whose budgets several components enforce or produce.
   */
  static final int MAX_BRANCHES = 50_000;

  static final int MAX_OPERATIONS = 200_000;

  /**
   * The diagram passed {@link #MAX_BRANCHES} branches or {@link #MAX_OPERATIONS} cached operations:
   * the analysis is too complex in this test order, and {@link BranchScopes} tries its next order
   * before reporting it. Its own type, so the retry catches nothing else.
   */
  static final class TooComplex extends ArcException {
    TooComplex() {
      super(422, "Branch analysis is too complex; split this graph into reusable rules");
    }
  }

  private record Branch(int variable, int low, int high) {}

  private record Operation(boolean conjunction, int a, int b) {}

  // IDs 0 and 1 are the false and true terminals. Other IDs index a decision branch.
  private final List<Branch> branches =
      new ArrayList<>(
          List.of(new Branch(Integer.MAX_VALUE, 0, 0), new Branch(Integer.MAX_VALUE, 1, 1)));
  private final Map<Branch, Integer> unique = new HashMap<>();
  private final Map<Operation, Integer> cache = new HashMap<>();
  private final Map<Integer, Integer> inverses = new HashMap<>(Map.of(0, 1, 1, 0));

  private int make(int variable, int low, int high) {
    if (low == high) return low;
    Branch b = new Branch(variable, low, high);
    Integer found = unique.get(b);
    if (found != null) return found;
    if (branches.size() >= MAX_BRANCHES) throw new TooComplex();
    int id = branches.size();
    branches.add(b);
    unique.put(b, id);
    return id;
  }

  int variable(int index) {
    return make(index, 0, 1);
  }

  int not(int id) {
    Integer result = inverses.get(id);
    if (result != null) return result;
    Branch b = branches.get(id);
    int inverse = make(b.variable(), not(b.low()), not(b.high()));
    inverses.put(id, inverse);
    inverses.put(inverse, id);
    return inverse;
  }

  int and(int a, int b) {
    return apply(true, a, b);
  }

  int or(int a, int b) {
    return apply(false, a, b);
  }

  private int apply(boolean conjunction, int a, int b) {
    if (a == b) return a;
    if (conjunction) {
      if (a == 0 || b == 0) return 0;
      if (a == 1) return b;
      if (b == 1) return a;
    } else {
      if (a == 1 || b == 1) return 1;
      if (a == 0) return b;
      if (b == 0) return a;
    }
    if (cache.size() > MAX_OPERATIONS) throw new TooComplex();
    Operation key = new Operation(conjunction, Math.min(a, b), Math.max(a, b));
    Integer found = cache.get(key);
    if (found != null) return found;
    Branch x = branches.get(a), y = branches.get(b);
    int top = Math.min(x.variable(), y.variable());
    int low =
        apply(conjunction, x.variable() == top ? x.low() : a, y.variable() == top ? y.low() : b);
    int high =
        apply(conjunction, x.variable() == top ? x.high() : a, y.variable() == top ? y.high() : b);
    int result = make(top, low, high);
    cache.put(key, result);
    return result;
  }
}
