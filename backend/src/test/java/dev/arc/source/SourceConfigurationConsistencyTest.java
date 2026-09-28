package dev.arc.source;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.error.ArcException;
import dev.arc.model.CatalogPage;
import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import dev.arc.model.SourceSummary;
import dev.arc.model.SourceVersionSummary;
import dev.arc.source.lookup.LookupSourceAdapter;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** A configuration either fails when it is saved or behaves the same in Test and in execution. */
class SourceConfigurationConsistencyTest {
  private final StoredSources repository = new StoredSources();
  private final SourceAdapters adapters = new SourceAdapters(List.of(new LookupSourceAdapter()));
  private final SourceService service =
      new SourceService(repository, new SourceValidator(adapters));
  private final SourceExecutionService execution =
      new SourceExecutionService(repository, adapters, new JsonPointerExtractor());
  private final SourceBinding binding = new SourceBinding("tax", 1, Map.of(), "/rate", "FAIL");

  @Test
  void aLookupCarryingSecretHeadersIsRejectedBeforeItCanBeTestedOrExecuted() {
    var nullAlias = new HashMap<String, String>();
    nullAlias.put("X-Unused", null);
    for (Map<String, String> headers : List.of(nullAlias, Map.of("X-Unused", "TOKEN")))
      assertThatThrownBy(() -> service.create(new SourceService.Create("tax", "Tax", tax(headers))))
          .isInstanceOfSatisfying(
              ArcException.class, error -> assertThat(error.status()).isEqualTo(422));
    assertThat(repository.stored).isEmpty();
  }

  @Test
  void anAcceptedLookupReturnsTheSameValueFromTestAndFromExecution() {
    service.create(new SourceService.Create("tax", "Tax", tax(null)));

    Object tested =
        execution.test("tax", new SourceExecutionService.Test(Map.of("key", "US"), null));
    var session = execution.openSession();
    session.definition("tax", 1);
    Object executed = session.read(binding, Map.of("key", "US"), deadline());

    assertThat(tested).isEqualTo(Map.of("rate", 0.07));
    assertThat(executed).isEqualTo(0.07);
  }

  @Test
  void aStoredVersionWithANullSecretHeaderAliasStillExecutesLikeItTests() {
    var headers = new LinkedHashMap<String, String>();
    headers.put("X-Unused", null);
    headers.put("X-Other", "TOKEN");
    repository.store("tax", tax(headers));

    Object tested = execution.test("tax", new SourceExecutionService.Test(Map.of("key", "US"), 1));
    var session = execution.openSession();
    SourceDefinition snapshot = session.definition("tax", 1);

    assertThat(tested).isEqualTo(Map.of("rate", 0.07));
    assertThat(session.read(binding, Map.of("key", "US"), deadline())).isEqualTo(0.07);
    assertThat(snapshot.secretHeaders())
        .containsExactly(entry("X-Unused", null), entry("X-Other", "TOKEN"));
    assertThatThrownBy(() -> snapshot.secretHeaders().clear())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  private static SourceDefinition tax(Map<String, String> secretHeaders) {
    return new SourceDefinition(
        "LOOKUP",
        null,
        List.of(new Input("key", "STRING", true, null)),
        Map.of("US", Map.of("rate", 0.07)),
        secretHeaders,
        3000);
  }

  private static ExecutionDeadline deadline() {
    return ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS);
  }

  /** Version 1 of each created source; enough for create, Test and pinned reads. */
  private static final class StoredSources implements SourceRepository {
    private final Map<String, DataSource> stored = new HashMap<>();

    void store(String id, SourceDefinition definition) {
      stored.put(id, new DataSource(id, id, 1, definition));
    }

    @Override
    public DataSource create(String id, String name, SourceDefinition definition) {
      store(id, definition);
      return stored.get(id);
    }

    @Override
    public DataSource get(String id, int version) {
      var source = stored.get(id);
      if (source == null || version != 1) throw new ArcException(404, "Source not found");
      return source;
    }

    @Override
    public DataSource latest(String id) {
      return get(id, 1);
    }

    @Override
    public List<DataSource> list() {
      throw new UnsupportedOperationException();
    }

    @Override
    public CatalogPage<SourceSummary> catalog(int offset, int limit, String search) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CatalogPage<SourceVersionSummary> versionSummaries(String id, int offset, int limit) {
      throw new UnsupportedOperationException();
    }

    @Override
    public List<DataSource> versions(String id) {
      throw new UnsupportedOperationException();
    }

    @Override
    public DataSource update(String id, String name, int revision, SourceDefinition definition) {
      throw new UnsupportedOperationException();
    }
  }
}
