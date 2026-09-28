package dev.arc.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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

  public <T> T decode(String value, Class<T> type) {
    try {
      return json.readValue(value, type);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Could not decode stored ARC definition", e);
    }
  }
}
