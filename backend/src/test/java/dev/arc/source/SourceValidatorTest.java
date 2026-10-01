package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import dev.arc.model.SourceDefinition.Field;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SourceValidatorTest {
  private final SourceAdapter http =
      adapter("HTTP", "HTTP sources", Field.URL, Field.SECRET_HEADERS);
  private final SourceAdapter lookup = adapter("LOOKUP", "Lookup tables", Field.ENTRIES);
  private final SourceAdapter memory = adapter("MEMORY", "Memory sources", Field.SECRET_HEADERS);
  private final SourceValidator validator =
      new SourceValidator(new SourceAdapters(List.of(http, lookup, memory)));

  @Test
  void aMissingDefinitionNamesEveryRegisteredKind() {
    assertThatThrownBy(() -> validator.validate(null))
        .hasMessage("Source kind must be HTTP or LOOKUP or MEMORY");
    assertThatThrownBy(() -> validator.validate(definition("CSV", null)))
        .hasMessage("Source kind must be HTTP or LOOKUP or MEMORY");
  }

  /**
   * A misspelled parameter type is unknown, as for a rule input; only a known collection type is
   * "not scalar". Every misspelling used to be reported as not scalar.
   */
  @Test
  void parameterTypesAreKnownScalarTypes() {
    for (String type : List.of("NUMBR", "number", ""))
      assertThatThrownBy(
              () ->
                  validator.validate(
                      new SourceDefinition(
                          "LOOKUP",
                          null,
                          List.of(new Input("key", type, true, null)),
                          Map.of(),
                          null,
                          0)))
          .as(type)
          .hasMessage("Unknown input type");
    for (String type : List.of("ARRAY", "OBJECT"))
      assertThatThrownBy(
              () ->
                  validator.validate(
                      new SourceDefinition(
                          "LOOKUP",
                          null,
                          List.of(new Input("key", type, true, null)),
                          Map.of(),
                          null,
                          0)))
          .as(type)
          .hasMessage("Source parameters must be scalar");
  }

  @Test
  void everyKindRejectsSecretHeadersWithoutANameOrAlias() {
    var missingAlias = new HashMap<String, String>();
    missingAlias.put("X-Unused", null);
    var missingName = new HashMap<String, String>();
    missingName.put(null, "TOKEN");

    for (Map<String, String> headers : List.of(missingAlias, missingName))
      assertThatThrownBy(() -> validator.validate(definition("MEMORY", headers)))
          .hasMessage("Secret headers map header names to uppercase environment aliases");
    verify(memory, never()).validate(any());

    validator.validate(definition("MEMORY", Map.of("X-Token", "TOKEN")));
    validator.validate(definition("MEMORY", null));
    verify(memory, times(2)).validate(any());
  }

  /**
   * Which optional fields a kind reads is one declared fact ({@code SourceAdapter.fields()}); the
   * validator refuses any other that is set before the adapter runs, with the adapter's noun. The
   * refusal is a 422, never the 500 that an unbounded stored value used to cause later.
   */
  @Test
  void aFieldTheKindDoesNotDeclareIsRefusedBeforeTheAdapterRuns() {
    var parameters = List.of(new Input("key", "STRING", true, null));
    for (Map<String, Object> entries :
        List.of(
            Map.<String, Object>of("unused", Map.of("deep", List.of(1, 2, 3))),
            Map.<String, Object>of("a", new BigDecimal("1E+5000"))))
      assertThatThrownBy(
              () ->
                  validator.validate(
                      new SourceDefinition(
                          "HTTP", "https://example.test/rates", List.of(), entries, null, 3000)))
          .as(entries.toString())
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).isEqualTo("HTTP sources do not use lookup entries");
              });
    assertThatThrownBy(
            () ->
                validator.validate(
                    new SourceDefinition(
                        "LOOKUP", "file:///etc/passwd", parameters, Map.of(), null, 3000)))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage()).isEqualTo("Lookup tables do not use a URL");
            });
    assertThatThrownBy(
            () ->
                validator.validate(
                    new SourceDefinition(
                        "LOOKUP", null, parameters, Map.of(), Map.of("X-Unused", "TOKEN"), 3000)))
        .hasMessage("Lookup tables do not use secret headers");
    verify(http, never()).validate(any());
    verify(lookup, never()).validate(any());

    // Unset means null, empty or blank; a primitive timeout is outside this rule.
    for (Map<String, Object> entries : Arrays.asList(null, Map.<String, Object>of()))
      validator.validate(
          new SourceDefinition(
              "HTTP", "https://example.test/rates", List.of(), entries, null, 3000));
    for (String url : Arrays.asList(null, "", "  "))
      validator.validate(new SourceDefinition("LOOKUP", url, parameters, Map.of(), null, 0));
    verify(http, times(2)).validate(any());
    verify(lookup, times(3)).validate(any());
  }

  private static SourceDefinition definition(String kind, Map<String, String> secretHeaders) {
    return new SourceDefinition(
        kind, null, List.of(new Input("key", "STRING", true, null)), null, secretHeaders, 0);
  }

  private static SourceAdapter adapter(String kind, String noun, Field... fields) {
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn(kind);
    when(adapter.noun()).thenReturn(noun);
    when(adapter.fields()).thenReturn(Set.of(fields));
    return adapter;
  }
}
