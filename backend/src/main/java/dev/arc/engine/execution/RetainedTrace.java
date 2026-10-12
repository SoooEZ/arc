package dev.arc.engine.execution;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.SerializableString;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
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
   * engine's ObjectMapper, which in the application is the one that writes the response, and the
   * response's UTF-8 generator appends them as they are: decoding them to text and encoding them
   * again was two more passes over up to 256 KiB per traced request.
   */
  static final class Serializer extends JsonSerializer<List<Engine.Step>> {
    @Override
    public void serialize(
        List<Engine.Step> value, JsonGenerator generator, SerializerProvider provider)
        throws IOException {
      if (value instanceof RetainedTrace retained)
        generator.writeRawValue(new RawJson(retained.json));
      else provider.defaultSerializeValue(List.copyOf(value), generator);
    }
  }

  /**
   * The retained array as a raw value: a UTF-8 generator takes the bytes, a text generator decodes
   * them once. Only the unquoted forms exist, because the array is JSON and never a string value.
   */
  private static final class RawJson implements SerializableString {
    private final byte[] json;

    RawJson(byte[] json) {
      this.json = json;
    }

    @Override
    public String getValue() {
      return new String(json, UTF_8);
    }

    @Override
    public int charLength() {
      return getValue().length();
    }

    @Override
    public byte[] asUnquotedUTF8() {
      return json;
    }

    @Override
    public int appendUnquotedUTF8(byte[] buffer, int offset) {
      if (buffer.length - offset < json.length) return -1;
      System.arraycopy(json, 0, buffer, offset, json.length);
      return json.length;
    }

    @Override
    public int appendUnquoted(char[] buffer, int offset) {
      String text = getValue();
      if (buffer.length - offset < text.length()) return -1;
      text.getChars(0, text.length(), buffer, offset);
      return text.length();
    }

    @Override
    public int writeUnquotedUTF8(OutputStream out) throws IOException {
      out.write(json);
      return json.length;
    }

    @Override
    public int putUnquotedUTF8(ByteBuffer buffer) {
      if (buffer.remaining() < json.length) return -1;
      buffer.put(json);
      return json.length;
    }

    @Override
    public char[] asQuotedChars() {
      throw neverQuoted();
    }

    @Override
    public byte[] asQuotedUTF8() {
      throw neverQuoted();
    }

    @Override
    public int appendQuotedUTF8(byte[] buffer, int offset) {
      throw neverQuoted();
    }

    @Override
    public int appendQuoted(char[] buffer, int offset) {
      throw neverQuoted();
    }

    @Override
    public int writeQuotedUTF8(OutputStream out) {
      throw neverQuoted();
    }

    @Override
    public int putQuotedUTF8(ByteBuffer buffer) {
      throw neverQuoted();
    }

    private static UnsupportedOperationException neverQuoted() {
      return new UnsupportedOperationException(
          "A retained trace is a raw JSON array, never a string");
    }
  }
}
