package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/** Full editor/arity contract, including the intentional dollar function namespace. */
class FunctionCatalogTest {
  private record Arity(String name, List<List<Integer>> accepted) {}

  @Test
  void preservesEveryCatalogEntryAndItsOrder() throws IOException {
    List<Functions.Entry> expected = fixture("catalog.json", new TypeReference<>() {});
    assertThat(Functions.catalog()).containsExactlyElementsOf(expected);
    assertThatThrownBy(() -> Functions.catalog().clear())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void functionsThatReadErrorValuesAreReferenceOnly() {
    // ARC reports an error as a failure, not as a value, so ERROR.TYPE could never answer: its
    // argument failed first ($ERROR.TYPE(1 / 0) was "Division by zero") or was no error (#N/A).
    var entry =
        Functions.catalog().stream()
            .filter(candidate -> candidate.name().equals("$ERROR.TYPE"))
            .findFirst()
            .orElseThrow();
    assertThat(entry.supported()).isFalse();
    assertThat(FunctionCatalog.excelFunctions()).doesNotContain("ERROR.TYPE");
    assertThatThrownBy(() -> Expressions.evaluate("$ERROR.TYPE(1 / 0)", Map.of()))
        .hasMessage("Unsupported function: ERROR.TYPE (see function catalog)");
  }

  @Test
  void preservesAcceptedArgumentCountsForEveryCatalogEntry() throws IOException {
    List<Arity> expected = fixture("arity.json", new TypeReference<>() {});
    assertThat(expected.stream().map(Arity::name).toList())
        .containsExactlyElementsOf(
            Functions.catalog().stream().map(entry -> entry.name().substring(1)).toList());
    for (Arity function : expected) {
      var expectedCounts = new ArrayList<Integer>();
      for (List<Integer> range : function.accepted()) {
        for (int count = range.getFirst(); count <= range.getLast(); count++)
          expectedCounts.add(count);
      }
      var actualCounts = new ArrayList<Integer>();
      // Includes both sides of ARC/POI's maximum arity (255), plus negative and zero counts.
      for (int count = -1; count <= 257; count++) {
        if (accepts(function.name(), count)) actualCounts.add(count);
      }
      assertThat(actualCounts).as(function.name()).containsExactlyElementsOf(expectedCounts);
    }
  }

  @Test
  void functionSnippetsEscapeLiteralDollarsAndRetainEditableArguments() {
    assertThat(Functions.catalog())
        .allSatisfy(
            entry -> {
              assertThat(entry.name()).startsWith("$");
              assertThat(entry.signature()).startsWith(entry.name() + "(");
              assertThat(entry.snippet()).startsWith("\\" + entry.name() + "(");
            });
    assertThat(Functions.catalog())
        .filteredOn(entry -> entry.name().equals("$MERGE"))
        .extracting(Functions.Entry::snippet)
        .containsExactly("\\$MERGE(${1:customer}, \\$OBJECT(\"${2:status}\", ${3:\"active\"}))");
    assertThat(Functions.catalog())
        .filteredOn(entry -> entry.name().equals("$YEAR"))
        .extracting(Functions.Entry::snippet)
        .containsExactly("\\$YEAR(${1:\\$DATE(2026, 9, 16)})");
  }

  @Test
  void everyArcCatalogEntryIsEvaluatedByArcAndEveryArcFunctionIsCatalogued() {
    List<String> arcEntries =
        Functions.catalog().stream()
            .filter(entry -> entry.origin().startsWith("ARC"))
            .map(entry -> entry.name().substring(1))
            .toList();
    assertThat(arcEntries).hasSize(BuiltinFunctionCatalog.specs().size());
    // An ARC function's own entry replaces any Excel help, so such help would never be shown: a
    // ROUNDUP entry sat there unused.
    assertThat(ExcelFunctionHelp.documentedNames())
        .doesNotContainAnyElementsOf(BuiltinFunctionCatalog.specs().keySet());
    var evaluatedByArc = new TreeSet<String>(Functions.arcFunctionNames());
    evaluatedByArc.addAll(ExpressionRuntime.lazyFunctionNames());
    // A collection function is credited by its constant, which owns its runtime code, not by a
    // name list that the runtime could silently fall through.
    for (CollectionFunction function : CollectionFunction.values())
      evaluatedByArc.add(function.name());
    // An ARC entry without ARC code would silently fall through to POI's floating point.
    assertThat(evaluatedByArc).containsAll(arcEntries);
    // Lazy Excel functions such as ISNA and CHOOSE keep their Excel catalog entries.
    assertThat(Functions.catalog().stream().map(entry -> entry.name().substring(1)))
        .containsAll(evaluatedByArc);
    for (CollectionFunction function : CollectionFunction.values())
      assertThat(Functions.catalog())
          .filteredOn(entry -> entry.name().equals("$" + function.name()))
          .extracting(Functions.Entry::category)
          .containsExactly("Collections");
    for (DecimalAggregate aggregate : DecimalAggregate.values()) {
      assertThat(arcEntries).contains(aggregate.name());
      assertThat(Functions.arcFunctionNames()).contains(aggregate.name());
    }
    assertThat(BuiltinFunctionCatalog.DECIMAL_AGGREGATES)
        .containsExactly("SUM", "MIN", "MAX", "AVG", "AVERAGE", "COUNT", "MUL");
    assertThat(BuiltinFunctionCatalog.ITEM_FUNCTIONS)
        .containsExactly("MAP", "FILTER", "ALL", "ANY");
    assertThat(BuiltinFunctionCatalog.REDUCE).isEqualTo("REDUCE");
  }

  /** Help and messages state a limit from the constant that enforces it, never a retyped number. */
  @Test
  void helpAndMessagesStateTheirLimitsFromTheConstants() {
    assertThat(Functions.catalog())
        .filteredOn(entry -> entry.name().equals("$REPT"))
        .extracting(Functions.Entry::description)
        .containsExactly(
            "Repeats text. ARC limits the result to "
                + Limits.format(Limits.MAX_STRING_CHARACTERS)
                + " characters.");
    String bound = "-" + Functions.MAX_ROUND_DIGITS + "…" + Functions.MAX_ROUND_DIGITS;
    assertThat(Functions.catalog())
        .filteredOn(entry -> List.of("$ROUND", "$ROUNDDOWN", "$ROUNDUP").contains(entry.name()))
        .hasSize(3)
        .allSatisfy(
            entry ->
                assertThat(entry.description())
                    .startsWith("Rounds to " + bound + " decimal places."));
    for (String name : List.of("ROUND", "ROUNDDOWN", "ROUNDUP")) {
      Expressions.evaluate("$" + name + "(1, " + Functions.MAX_ROUND_DIGITS + ")", Map.of());
      Expressions.evaluate("$" + name + "(1, -" + Functions.MAX_ROUND_DIGITS + ")", Map.of());
      for (int digits : new int[] {Functions.MAX_ROUND_DIGITS + 1, -Functions.MAX_ROUND_DIGITS - 1})
        assertThatThrownBy(() -> Expressions.evaluate("$" + name + "(1, " + digits + ")", Map.of()))
            .as(name + " " + digits)
            .hasMessage(
                "Round precision must be -"
                    + Functions.MAX_ROUND_DIGITS
                    + " to "
                    + Functions.MAX_ROUND_DIGITS);
    }
  }

  @Test
  void decimalAggregatesStayDecimalWhilePoiAggregatesUseDoubles() {
    assertThat(Expressions.evaluate("$MUL(0.1, 0.2, 3)", Map.of()))
        .isEqualTo(new BigDecimal("0.06"));
    assertThat(Expressions.evaluate("$PRODUCT(0.1, 0.2, 3)", Map.of()))
        .isEqualTo(new BigDecimal("0.06000000000000001"));
  }

  @Test
  void preservesDistinctUnsupportedCountAndObjectPairErrors() {
    assertThatThrownBy(() -> Functions.arity("INDIRECT", 1))
        .isInstanceOf(ArcException.class)
        .hasMessage("Unsupported function: INDIRECT (see function catalog)");
    assertThatThrownBy(() -> Functions.arity("UNKNOWN_FUNCTION", 1))
        .isInstanceOf(ArcException.class)
        .hasMessage("Unsupported function: UNKNOWN_FUNCTION (see function catalog)");
    assertThatThrownBy(() -> Functions.arity("SUM", 0))
        .isInstanceOf(ArcException.class)
        .hasMessage("Invalid argument count for SUM");
    assertThatThrownBy(() -> Functions.arity("OBJECT", 101))
        .isInstanceOf(ArcException.class)
        .hasMessage("OBJECT expects key/value pairs");
    assertThatThrownBy(() -> Functions.arity("OBJECT", 102))
        .isInstanceOf(ArcException.class)
        .hasMessage("Invalid argument count for OBJECT");
  }

  private static boolean accepts(String name, int count) {
    try {
      Functions.arity(name, count);
      return true;
    } catch (ArcException invalid) {
      return false;
    }
  }

  private static <T> T fixture(String name, TypeReference<T> type) throws IOException {
    try (var input =
        FunctionCatalogTest.class.getResourceAsStream("/expression/functions/" + name)) {
      if (input == null) throw new AssertionError("Missing function contract fixture: " + name);
      return new ObjectMapper().readValue(input, type);
    }
  }
}
