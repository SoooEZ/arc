package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceServiceTest {
  private final SourceRepository repository = mock(SourceRepository.class);

  private SourceService service(List<SourceAdapter> plugins) {
    var adapters = new SourceAdapters(plugins);
    return new SourceService(
        repository,
        new SourceValidator(adapters),
        adapters,
        new JsonPointerExtractor(new ObjectMapper()));
  }

  @Test
  void aNewAdapterWorksWithoutChangingTheServiceAndPreservesTypedDefaults() {
    var calls = new java.util.concurrent.atomic.AtomicInteger();
    SourceAdapter memory =
        new SourceAdapter() {
          public String kind() {
            return "MEMORY";
          }

          public void validate(SourceDefinition definition) {
            assertThat(definition.kind()).isEqualTo("MEMORY");
          }

          public Object fetch(String id, SourceDefinition definition, Map<String, Object> values) {
            calls.incrementAndGet();
            return Map.of("value", values.get("key"));
          }
        };
    var config =
        new SourceDefinition(
            "MEMORY", null, List.of(new Input("key", "NUMBER", true, 12)), null, null, 0);
    var source = new DataSource("memory", "Memory", 1, config);
    when(repository.get("memory", 1)).thenReturn(source);
    var service = service(List.of(memory));
    service.create(new SourceService.Create("memory", "Memory", config));
    verify(repository).create("memory", "Memory", config);
    Object value =
        service.read(new SourceBinding("memory", 1, Map.of(), "/value", "FAIL"), Map.of());
    assertThat(value).isEqualTo(new java.math.BigDecimal("12"));
    assertThatThrownBy(() -> service.fetch("memory", 1, Map.of("key", "bad")))
        .hasMessageContaining("must be number");
    assertThatThrownBy(() -> service.fetch("memory", 1, Map.of("unknown", 3)))
        .hasMessageContaining("Unknown source parameter");
    assertThat(calls).hasValue(1);
    assertThatThrownBy(() -> new SourceAdapters(List.of(memory)).require("unknown"))
        .hasMessage("Source kind must be MEMORY");
  }

  @Test
  void duplicateAdaptersFailFastInsteadOfSilentlyChangingBehavior() {
    assertThatThrownBy(
            () -> new SourceAdapters(List.of(new LookupSourceAdapter(), new LookupSourceAdapter())))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Duplicate source adapter");
  }

  @Test
  void lookupDistinguishesNullValuesFromMissingKeys() {
    var adapter = new LookupSourceAdapter();
    var values = new java.util.HashMap<String, Object>();
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
