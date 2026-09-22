package dev.arc.source.lookup;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LookupSourceAdapterTest {
  @Test
  void lookupDistinguishesNullValuesFromMissingKeys() {
    var adapter = new LookupSourceAdapter();
    var values = new HashMap<String, Object>();
    values.put("known", null);
    var config =
        new SourceDefinition(
            "LOOKUP", null, List.of(new Input("key", "STRING", true, null)), values, null, 0);
    adapter.validate(config);
    assertThat(adapter.fetch("table", config, Map.of("key", "known"))).isNull();
    assertThatThrownBy(() -> adapter.fetch("table", config, Map.of("key", "missing")))
        .isInstanceOf(ArcException.class)
        .hasMessageContaining("was not found");
  }
}
