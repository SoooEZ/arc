package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceValidatorTest {
  private final SourceAdapter memory = adapter("MEMORY");
  private final SourceValidator validator =
      new SourceValidator(new SourceAdapters(List.of(adapter("HTTP"), adapter("LOOKUP"), memory)));

  @Test
  void aMissingDefinitionNamesEveryRegisteredKind() {
    assertThatThrownBy(() -> validator.validate(null))
        .hasMessage("Source kind must be HTTP or LOOKUP or MEMORY");
    assertThatThrownBy(() -> validator.validate(definition("CSV", null)))
        .hasMessage("Source kind must be HTTP or LOOKUP or MEMORY");
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

  private static SourceDefinition definition(String kind, Map<String, String> secretHeaders) {
    return new SourceDefinition(
        kind, null, List.of(new Input("key", "STRING", true, null)), null, secretHeaders, 0);
  }

  private static SourceAdapter adapter(String kind) {
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn(kind);
    return adapter;
  }
}
