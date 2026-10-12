package dev.arc.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.error.ArcException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The value bounds, applied while a document is parsed: an oversized document stops at its first
 * exceeded bound with the message the walk over the built value gives, instead of being built in
 * full first.
 */
class BoundedJsonParserTest {
  private final ObjectReader reader =
      JsonMapper.builder()
          .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
          .build()
          .readerFor(Object.class)
          .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

  /**
   * A bound met early in a document that goes on for a megabyte: the tail must stay unread. The
   * tail keeps the root within its bounds, so the walk over the built value meets the same bound
   * first and the two agree on the message.
   */
  @Test
  void anOversizedDocumentFailsWhereTheBoundIsExceededInsteadOfAfterItWasBuilt() throws Exception {
    String tail = (",\"" + "t".repeat(2_000) + "\"").repeat(500);
    record Case(String name, String document, String message) {}
    var cases =
        List.of(
            new Case(
                "1,001 items",
                "[[" + "0,".repeat(1_000) + "0]" + tail + "]",
                "Array exceeds 1,000 items"),
            new Case(
                "1,001 fields",
                "[{" + fields(1_001) + "}" + tail + "]",
                "Object exceeds 1,000 fields"),
            new Case(
                "a 2,001-character string",
                "[\"" + "s".repeat(2_001) + "\"" + tail + "]",
                "String exceeds 2,000 characters"),
            new Case(
                "a 2,001-character key",
                "[{\"" + "k".repeat(2_001) + "\":1}" + tail + "]",
                "String exceeds 2,000 characters"),
            new Case(
                "nine nested levels",
                "[" + "[".repeat(8) + "1" + "]".repeat(8) + tail + "]",
                "Value exceeds collection depth or size limit"),
            new Case(
                "10,001 elements",
                "[" + ("[" + "1,".repeat(998) + "1],").repeat(11) + "[]" + tail + "]",
                "Value exceeds collection depth or size limit"));
    for (Case oversized : cases) {
      byte[] body = oversized.document().getBytes(StandardCharsets.UTF_8);
      try (JsonParser parser = reader.createParser(body)) {
        assertThatThrownBy(() -> reader.readValue(new BoundedJsonParser(parser)))
            .as(oversized.name())
            .isInstanceOf(ArcException.class)
            .hasMessage(oversized.message());
        assertThat(parser.currentLocation().getByteOffset())
            .as(oversized.name() + " stops before the tail")
            .isLessThan(body.length / 4);
      }
      // The walk over the built value agrees on each of these documents.
      assertThatThrownBy(() -> ValueBounds.bounded(reader.readValue(body)))
          .as(oversized.name() + " by the walk")
          .hasMessage(oversized.message());
    }
  }

  @Test
  void aDocumentWithinTheBoundsReadsAsWithoutThePass() throws Exception {
    // A value eight levels below the root, 1,000-item arrays and 2,000-character text are all
    // allowed, and the element count includes the root, every container, key and item: 1 + 9 +
    // 8,991 fits.
    var within =
        List.of(
            "[" + "[".repeat(7) + "1" + "]".repeat(7) + "]",
            "[" + "0,".repeat(999) + "0]",
            "{" + fields(1_000) + "}",
            "[\"" + "s".repeat(2_000) + "\",{\"" + "k".repeat(2_000) + "\":null}]",
            "[" + ("[" + "1,".repeat(998) + "1],").repeat(8) + "[" + "1,".repeat(998) + "1]]",
            "{\"a\":{\"b\":[1,2.5,\"x\",true,null,{}]},\"c\":[]}",
            "1.5",
            "\"text\"");
    for (String document : within) {
      byte[] body = document.getBytes(StandardCharsets.UTF_8);
      Object plain = reader.readValue(body);
      try (JsonParser parser = reader.createParser(body)) {
        Object bounded = reader.readValue(new BoundedJsonParser(parser));
        assertThat(bounded).isEqualTo(plain);
      }
      assertThat(ValueBounds.bounded(plain)).isSameAs(plain);
    }
  }

  /** The deserializer's shortcuts (nextValue, skipChildren) go through the counting pass too. */
  @Test
  void everyWayOfAdvancingTheParserCounts() throws IOException {
    byte[] body = ("[" + "0,".repeat(1_000) + "0]").getBytes(StandardCharsets.UTF_8);
    try (JsonParser parser = new BoundedJsonParser(reader.createParser(body))) {
      parser.nextToken();
      assertThatThrownBy(parser::skipChildren).hasMessage("Array exceeds 1,000 items");
    }
    try (JsonParser parser = new BoundedJsonParser(reader.createParser(body))) {
      parser.nextToken();
      assertThatThrownBy(
              () -> {
                while (parser.nextValue() != null) {}
              })
          .hasMessage("Array exceeds 1,000 items");
    }
    byte[] object = ("{" + fields(1_001) + "}").getBytes(StandardCharsets.UTF_8);
    try (JsonParser parser = new BoundedJsonParser(reader.createParser(object))) {
      parser.nextToken();
      assertThatThrownBy(
              () -> {
                while (parser.nextFieldName() != null) parser.nextToken();
              })
          .hasMessage("Object exceeds 1,000 fields");
    }
    Object small = reader.readValue(new BoundedJsonParser(reader.createParser("{\"a\":[1]}")));
    assertThat(small).isEqualTo(Map.of("a", List.of(1)));
  }

  private static String fields(int count) {
    var fields = new StringBuilder();
    for (int index = 0; index < count; index++) {
      if (index > 0) fields.append(',');
      fields.append("\"f").append(index).append("\":").append(index);
    }
    return fields.toString();
  }
}
