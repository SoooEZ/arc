package dev.arc.source;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class JsonPointerExtractorTest {
  private final JsonPointerExtractor extractor = new JsonPointerExtractor();

  @Test
  void returnsTheSelectedPartOfTheParsedValueWithoutCopyingTheResponse() {
    var price = new LinkedHashMap<String, Object>();
    price.put("amount", new BigDecimal("100.0"));
    var response = Map.of("data", List.of(Map.of("price", price)));

    assertThat(extractor.extract(response, "/data/0/price")).isSameAs(price);
    assertThat(extractor.extract(response, "")).isSameAs(response);
    assertThat(extractor.extract(response, null)).isSameAs(response);
  }

  @Test
  void selectedDecimalsKeepTheirScale() {
    var response =
        Map.of(
            "limit", new BigDecimal("100.0"),
            "total", new BigDecimal("2500.00"),
            "items", List.of(new BigDecimal("1.20")));

    assertThat(extractor.extract(response, "/limit")).hasToString("100.0");
    assertThat(extractor.extract(response, "/total")).hasToString("2500.00");
    assertThat(extractor.extract(response, "/items/0")).hasToString("1.20");
  }

  @Test
  void decodesEscapedPropertyNamesAndArrayIndexes() {
    var response =
        Map.of(
            "a/b", Map.of("m~n", List.of("zero", "one")),
            "~1", "tilde one",
            "", "empty name",
            "7", "numeric name");

    assertThat(extractor.extract(response, "/a~1b/m~0n/1")).isEqualTo("one");
    assertThat(extractor.extract(response, "/~01")).isEqualTo("tilde one");
    assertThat(extractor.extract(response, "/")).isEqualTo("empty name");
    assertThat(extractor.extract(response, "/7")).isEqualTo("numeric name");
  }

  @Test
  void aSelectedNullIsAValueButAMissingFieldIsAnError() {
    var response = new HashMap<String, Object>();
    response.put("present", null);

    assertThat(extractor.extract(response, "/present")).isNull();
    assertThatThrownBy(() -> extractor.extract(response, "/absent"))
        .hasMessage("Source JSON pointer did not match a value");
  }

  @Test
  void aPointerWithoutTheLeadingSlashIsAnOrdinaryInvalidBinding() {
    assertThatThrownBy(() -> extractor.extract(Map.of("rate", 1), "rate"))
        .isInstanceOf(ArcException.class)
        .hasMessage("Use a JSON pointer starting with /");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/items/2",
        "/items/-1",
        "/items/01",
        "/items/-",
        "/items/first",
        "/items/0/deeper",
        "/count/0",
        "/missing",
        "/present/field"
      })
  void pointersThatSelectNothingFail(String pointer) {
    var response = new HashMap<String, Object>();
    response.put("items", List.of("a", "b"));
    response.put("count", 2);
    response.put("present", null);

    assertThatThrownBy(() -> extractor.extract(response, pointer))
        .hasMessage("Source JSON pointer did not match a value");
  }
}
