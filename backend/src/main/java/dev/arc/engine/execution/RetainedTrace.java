package dev.arc.engine.execution;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.AbstractList;
import java.util.List;

/**
 * The retained trace steps together with their JSON array, serialized once while they were
 * collected and counted against the byte budget. The response writes those bytes as they are, so a
 * traced request serializes its trace once instead of twice.
 */
final class RetainedTrace extends AbstractList<Engine.Step> {
  private final List<Engine.Step> steps;
  private final byte[] json;

  RetainedTrace(List<Engine.Step> steps, byte[] json) {
    this.steps = steps;
    this.json = json;
  }

  @Override
  public Engine.Step get(int index) {
    return steps.get(index);
  }

  @Override
  public int size() {
    return steps.size();
  }

  /**
   * Writes a retained trace's own bytes and any other step list normally. The bytes come from the
   * engine's ObjectMapper, which in the application is the one that writes the response.
   */
  static final class Serializer extends JsonSerializer<List<Engine.Step>> {
    @Override
    public void serialize(
        List<Engine.Step> value, JsonGenerator generator, SerializerProvider provider)
        throws IOException {
      if (value instanceof RetainedTrace retained)
        generator.writeRawValue(new String(retained.json, StandardCharsets.UTF_8));
      else provider.defaultSerializeValue(List.copyOf(value), generator);
    }
  }
}
