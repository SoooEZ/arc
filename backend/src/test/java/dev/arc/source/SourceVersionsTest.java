package dev.arc.source;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import dev.arc.model.DataSource;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import java.util.ArrayList;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceVersionsTest {
  /**
   * A version weighs what it retains, its parameter defaults included. Versions with twenty
   * 2,000-character defaults weighed 2,816 units each, so all 256 stayed cached, about 20 MiB
   * against a 16 MiB bound.
   */
  @Test
  void parameterDefaultsCountTowardsTheCacheBound() {
    var repository = mock(SourceRepository.class);
    when(repository.get(eq("rates"), anyInt()))
        .thenAnswer(call -> withLongDefaults(call.getArgument(1)));
    var versions = new SourceVersions(repository);
    for (int version = 1; version <= 256; version++) versions.get("rates", version);
    versions.get("rates", 1);
    verify(repository, times(2)).get("rates", 1);
  }

  private static DataSource withLongDefaults(int version) {
    var parameters = new ArrayList<Input>();
    for (int index = 0; index < 20; index++)
      parameters.add(new Input("p" + index, "STRING", false, (version + "-").repeat(1000)));
    return new DataSource(
        "rates",
        "Rates",
        version,
        new SourceDefinition("LOOKUP", null, parameters, Map.of(), null, 1000));
  }
}
