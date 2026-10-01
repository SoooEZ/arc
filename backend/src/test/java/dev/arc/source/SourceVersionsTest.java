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

  /**
   * A number weighs what it retains: a 100-digit decimal holds a BigInteger and its digits. Every
   * number weighed 16 units, so 120 lookup versions of 1,000 such entries weighed about 5 MiB and
   * stayed cached while they held about 28 MiB.
   */
  @Test
  void longDecimalsCountTowardsTheCacheBound() {
    var repository = mock(SourceRepository.class);
    when(repository.get(eq("rates"), anyInt()))
        .thenAnswer(call -> withLongDecimals(call.getArgument(1)));
    var versions = new SourceVersions(repository);
    for (int version = 1; version <= 120; version++) versions.get("rates", version);
    versions.get("rates", 1);
    verify(repository, times(2)).get("rates", 1);
  }

  private static DataSource withLongDecimals(int version) {
    var entries = new java.util.LinkedHashMap<String, Object>();
    for (int index = 0; index < 1000; index++)
      entries.put("k" + index, new java.math.BigDecimal(version + "1".repeat(99)));
    return new DataSource(
        "rates",
        "Rates",
        version,
        new SourceDefinition(
            "LOOKUP",
            null,
            java.util.List.of(new Input("key", "STRING", true, null)),
            entries,
            null,
            1000));
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
