package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Full editor/arity contract captured before catalog responsibilities were separated. */
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
  void preservesAcceptedArgumentCountsForEveryCatalogEntry() throws IOException {
    List<Arity> expected = fixture("arity.json", new TypeReference<>() {});
    assertThat(expected.stream().map(Arity::name).toList())
        .containsExactlyElementsOf(
            Functions.catalog().stream().map(Functions.Entry::name).toList());
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
