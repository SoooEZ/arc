package dev.arc.persistence;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.error.ArcException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class StoredTextTest {
  private final JsonCodec json = new JsonCodec(new ObjectMapper());

  @Test
  void nulCharactersAnywhereInStoredJsonAreInvalidValues() {
    for (Object value :
        List.of(
            Map.of("label", "Calc\0ulate"),
            Map.of("entries", Map.of("US", List.of("a", "\0"))),
            Map.of("key\0", 1))) {
      assertThatThrownBy(() -> json.encode(value))
          .isInstanceOfSatisfying(
              ArcException.class,
              invalid -> {
                assertThat(invalid.status()).isEqualTo(422);
                assertThat(invalid.getMessage())
                    .isEqualTo("Text cannot contain the NUL character (U+0000)");
              });
    }
  }

  @Test
  void escapeLikeTextAndOtherControlCharactersRemainStorable() {
    String backslashText = "\\u0000 and \\\\u0000";
    assertThat(json.encode(Map.of("expression", backslashText)))
        .isEqualTo("{\"expression\":\"\\\\u0000 and \\\\\\\\u0000\"}");
    assertThat(json.encode(Map.of("label", "tab\tnew\nline\u0001")))
        .isEqualTo("{\"label\":\"tab\\tnew\\nline\\u0001\"}");
  }

  @Test
  void columnTextRejectsNulButAllowsMissingValues() {
    StoredText.requireStorable("Order pricing", null, "");
    assertThatThrownBy(() -> StoredText.requireStorable("Order", "pri\0cing"))
        .hasMessage(StoredText.NUL_MESSAGE);
  }

  @Test
  void unpairedSurrogatesAreRejectedInsteadOfBeingStoredAsQuestionMarks() {
    // The JDBC driver stored "a\ud800b" as "a?b" with 201; a valid pair is ordinary text.
    for (String text : List.of("a\ud800b", "d\udc00e", "k\ud83d"))
      assertThatThrownBy(() -> StoredText.requireStorable("Order", text))
          .as(text)
          .hasMessage("Text cannot contain an unpaired UTF-16 surrogate");
    for (Object value :
        List.of(
            Map.of("name", "a\ud800b"),
            Map.of("k\ud83d", 1),
            Map.of("entries", List.of("d\udc00e"))))
      assertThatThrownBy(() -> json.encode(value))
          .isInstanceOfSatisfying(
              ArcException.class,
              invalid -> {
                assertThat(invalid.status()).isEqualTo(422);
                assertThat(invalid.getMessage())
                    .isEqualTo("Text cannot contain an unpaired UTF-16 surrogate");
              });
    StoredText.requireStorable("smile 😀", "\\ud800");
    assertThat(json.encode(Map.of("label", "😀 \\ud800")))
        .isEqualTo("{\"label\":\"😀 \\\\ud800\"}");
  }
}
