package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException;
import java.util.List;
import org.junit.jupiter.api.Test;

class DisplayNamesTest {
  @Test
  void aNameOfOnlyUnicodeSpacesIsRefusedLikeABlankOne() {
    // Java's trim() removes only characters up to U+0020, so a name typed as one full-width space
    // with a Chinese IME (U+3000) or as em spaces was stored and shown as a blank title; then the
    // no-break spaces (U+00A0, U+2007, U+202F), which String.isBlank keeps, still were.
    for (String blank :
        List.of(
            "",
            "   ",
            "\u3000",
            "\u2003\u2003",
            " \u2028 ",
            " \u205f",
            "\u00a0",
            "\u00a0\u00a0",
            " \u00a0 ",
            "\u2007",
            "\u202f",
            "\u00a0\u3000\u202f"))
      assertThatThrownBy(() -> DisplayNames.normalize("Rule", blank))
          .as("[%s]", blank)
          .isInstanceOf(ArcException.class)
          .hasMessage("Rule name must contain 1 to 160 characters");
    assertThatThrownBy(() -> DisplayNames.normalize("Source", "\u3000"))
        .hasMessage("Source name must contain 1 to 160 characters");
    // Names are still trimmed as before, and a space beside other text is kept as written.
    assertThat(DisplayNames.normalize("Rule", " Tax ")).isEqualTo("Tax");
    assertThat(DisplayNames.normalize("Rule", "\u3000Tax")).isEqualTo("\u3000Tax");
    assertThat(DisplayNames.normalize("Rule", "\u00a0Tax\u00a0")).isEqualTo("\u00a0Tax\u00a0");
  }
}
