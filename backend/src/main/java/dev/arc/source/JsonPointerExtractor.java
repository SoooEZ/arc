package dev.arc.source;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import org.springframework.stereotype.Component;

@Component
public final class JsonPointerExtractor {
  private final ObjectMapper json;

  public JsonPointerExtractor(ObjectMapper json) {
    this.json = json;
  }

  public Object extract(Object value, String pointer) {
    if (pointer == null || pointer.isEmpty()) return value;
    JsonNode node = json.valueToTree(value).at(pointer);
    if (node.isMissingNode())
      throw ArcException.invalid("Source JSON pointer did not match a value");
    return json.convertValue(node, Object.class);
  }
}
