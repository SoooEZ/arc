package dev.arc.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;

/** Single JSONB codec using the same configured decimal semantics as HTTP. */
@Component
public final class JsonCodec {
  private final ObjectMapper json;

  public JsonCodec(ObjectMapper json) {
    this.json = json;
  }

  /** JSON for a JSONB column; a string containing U+0000 is rejected with 422. */
  public String encode(Object value) {
    String encoded;
    try {
      encoded = json.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Could not encode stored ARC definition", e);
    }
    StoredText.requireStorableJson(encoded);
    return encoded;
  }

  /**
   * JSON for a draft or source configuration that editors save back: refused with 422 when, written
   * as responses write it, it would not fit in that save. Plain decimals made 20,000 copies of
   * "1e100" grow from a 140 KB save to 2 MB stored, and every later save from the editor was 413.
   */
  public String encodeEditable(Object value) {
    String encoded = encode(value);
    if (encoded.getBytes(StandardCharsets.UTF_8).length > Limits.MAX_EDITABLE_JSON_BYTES)
      throw ArcException.invalid(
          "Definition exceeds "
              + Limits.formatBytes(Limits.MAX_EDITABLE_JSON_BYTES)
              + " once its numbers are written out in full, more than a save can send back");
    return encoded;
  }

  /**
   * A stored value, read leniently where requests are strict: it was validated when it was written,
   * and a field a later model no longer has must not make a published version unreadable.
   */
  public <T> T decode(String value, Class<T> type) {
    try {
      return json.readerFor(type)
          .without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .readValue(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Could not decode stored ARC definition", e);
    }
  }
}
