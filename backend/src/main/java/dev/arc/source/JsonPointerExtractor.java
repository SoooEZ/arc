package dev.arc.source;

import com.fasterxml.jackson.core.JsonPointer;
import dev.arc.error.ArcException;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Selects part of a provider value with an RFC 6901 JSON Pointer. It walks the parsed maps and
 * lists directly, so the selected value is the provider's own object: decimals keep their scale
 * ({@code 100.0} stays {@code 100.0}) and the rest of the response is never copied.
 */
@Component
public final class JsonPointerExtractor {
  /** Returns the selected value, which may be null; an empty pointer selects the whole value. */
  public Object extract(Object value, String pointer) {
    if (pointer == null || pointer.isEmpty()) return value;
    Object selected = value;
    for (var segment = segments(pointer); !segment.matches(); segment = segment.tail())
      selected = child(selected, segment);
    return selected;
  }

  /** Jackson decodes each segment: "~1" is "/", "~0" is "~", and indexes have no leading zeros. */
  private static JsonPointer segments(String pointer) {
    try {
      return JsonPointer.compile(pointer);
    } catch (IllegalArgumentException malformed) {
      throw ArcException.invalid("Use a JSON pointer starting with /");
    }
  }

  private static Object child(Object parent, JsonPointer segment) {
    if (parent instanceof Map<?, ?> object && object.containsKey(segment.getMatchingProperty()))
      return object.get(segment.getMatchingProperty());
    if (parent instanceof List<?> array
        && segment.getMatchingIndex() >= 0
        && segment.getMatchingIndex() < array.size()) return array.get(segment.getMatchingIndex());
    throw ArcException.invalid("Source JSON pointer did not match a value");
  }
}
