package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.model.Definition;
import org.junit.jupiter.api.Test;

class JsonCodecTest {
  /**
   * Request bodies refuse unknown fields; stored versions are read leniently, so a field a later
   * model no longer has never makes a published version unreadable.
   */
  @Test
  void aStoredVersionWithAFieldTheModelNoLongerHasStaysReadable() {
    var requestStrict =
        JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    Definition stored =
        new JsonCodec(requestStrict)
            .decode(
                "{\"schemaVersion\":1,\"inputs\":[],\"nodes\":[],\"edges\":[],\"retired\":true}",
                Definition.class);
    assertThat(stored.schemaVersion()).isEqualTo(1);
    assertThat(stored.nodes()).isEmpty();
  }
}
