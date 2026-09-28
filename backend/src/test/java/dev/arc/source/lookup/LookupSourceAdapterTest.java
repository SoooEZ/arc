package dev.arc.source.lookup;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceAdapters;
import dev.arc.source.SourceValidator;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LookupSourceAdapterTest {
  private final LookupSourceAdapter adapter = new LookupSourceAdapter();

  @Test
  void lookupDistinguishesNullValuesFromMissingKeys() {
    var values = new HashMap<String, Object>();
    values.put("known", null);
    var config = table("STRING", values);
    adapter.validate(config);
    assertThat(fetch(config, "known")).isNull();
    assertThatThrownBy(() -> fetch(config, "missing"))
        .isInstanceOf(ArcException.class)
        .hasMessageContaining("was not found");
  }

  @ParameterizedTest
  @CsvSource({
    "20, twenty",
    "20.0, twenty",
    "2E+1, twenty",
    "20.000, twenty",
    "1E+3, thousand",
    "1000.00, thousand",
    "1.000E+3, thousand",
    "0.50, half",
    "5E-1, half",
    "0, zero",
    "0.00, zero",
    "0E+2, zero"
  })
  void numberKeysFindTheEntryForTheSameNumberWhateverItsScaleOrNotation(
      String key, String expected) {
    var config =
        table("NUMBER", Map.of("20", "twenty", "1000", "thousand", "0.5", "half", "0", "zero"));
    adapter.validate(config);
    assertThat(fetch(config, new BigDecimal(key))).isEqualTo(expected);
  }

  @Test
  void numberKeysAlsoFindEntriesWrittenWithTrailingZerosOrExponents() {
    var config = table("NUMBER", Map.of("1.50", "one and a half", "2E+1", "twenty"));
    assertThat(fetch(config, new BigDecimal("1.5"))).isEqualTo("one and a half");
    assertThat(fetch(config, new BigDecimal("20"))).isEqualTo("twenty");
    assertThatThrownBy(() -> fetch(config, new BigDecimal("2")))
        .hasMessage("Lookup key was not found in table");
  }

  @Test
  void theCanonicalEntryWinsWhenATableSpellsOneNumberTwice() {
    var entries = new LinkedHashMap<String, Object>();
    entries.put("1.0", "scaled");
    entries.put("1", "canonical");
    var config = table("NUMBER", entries);
    assertThat(fetch(config, new BigDecimal("1.0"))).isEqualTo("canonical");
    assertThat(fetch(config, new BigDecimal("1"))).isEqualTo("canonical");
  }

  @Test
  void stringAndBooleanKeysKeepTheirExactText() {
    var strings = table("STRING", Map.of("20", "number text", "20.0", "scaled text"));
    assertThat(fetch(strings, "20.0")).isEqualTo("scaled text");
    assertThatThrownBy(() -> fetch(strings, "2E+1")).hasMessageContaining("was not found");
    var booleans = table("BOOLEAN", Map.of("true", "yes", "false", "no"));
    assertThat(fetch(booleans, true)).isEqualTo("yes");
    assertThat(fetch(booleans, false)).isEqualTo("no");
  }

  @Test
  void aNullKeyFailsInsteadOfLookingUpTheTextNull() {
    var config = table("STRING", Map.of("null", "the text null"));
    var inputs = new HashMap<String, Object>();
    inputs.put("key", null);
    assertThatThrownBy(() -> adapter.fetch("table", config, inputs, deadline()))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.recoverable()).isTrue())
        .hasMessage("Lookup key must not be null");
  }

  /**
   * The table declares that it reads only its entries; the shared validator refuses secret headers
   * and a URL from that declaration, so the adapter no longer checks them itself.
   */
  @Test
  void lookupTablesDeclareOnlyTheirEntriesAndCannotCarrySecretHeaders() {
    assertThat(adapter.fields()).containsExactly(SourceDefinition.Field.ENTRIES);
    var validator = new SourceValidator(new SourceAdapters(List.of(adapter)));
    var entries = Map.<String, Object>of("US", 0.07);
    var key = List.of(new Input("key", "STRING", true, null));
    assertThatThrownBy(
            () ->
                validator.validate(
                    new SourceDefinition(
                        "LOOKUP", null, key, entries, Map.of("X-Unused", "TOKEN"), 0)))
        .hasMessage("Lookup tables do not use secret headers");
    assertThatCode(
            () ->
                validator.validate(new SourceDefinition("LOOKUP", null, key, entries, Map.of(), 0)))
        .doesNotThrowAnyException();
    assertThatCode(
            () -> validator.validate(new SourceDefinition("LOOKUP", null, key, entries, null, 0)))
        .doesNotThrowAnyException();
  }

  private static SourceDefinition table(String keyType, Map<String, Object> entries) {
    return new SourceDefinition(
        "LOOKUP", null, List.of(new Input("key", keyType, true, null)), entries, null, 0);
  }

  private Object fetch(SourceDefinition config, Object key) {
    return adapter.fetch("table", config, Map.of("key", key), deadline());
  }

  private static ExecutionDeadline deadline() {
    return ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS);
  }
}
