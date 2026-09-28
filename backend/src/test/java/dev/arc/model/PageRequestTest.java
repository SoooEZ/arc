package dev.arc.model;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class PageRequestTest {
  @Test
  void omittedValuesReadTheFirstDefaultPageWithoutSearch() {
    assertThat(PageRequest.of(null, null, null)).isEqualTo(new PageRequest(0, 20, ""));
    assertThat(PageRequest.of(40, 10, "tax")).isEqualTo(new PageRequest(40, 10, "tax"));
  }

  @Test
  void bothSidesOfEveryBoundAreChecked() {
    assertThat(new PageRequest(0, 1, "")).isNotNull();
    assertThat(new PageRequest(Integer.MAX_VALUE, 100, "")).isNotNull();
    for (int[] bounds : new int[][] {{-1, 20}, {Integer.MIN_VALUE, 20}, {0, 0}, {0, 101}}) {
      assertThatIllegalArgumentException()
          .isThrownBy(() -> new PageRequest(bounds[0], bounds[1], ""))
          .withMessage("Use offset >= 0 and limit from 1 to 100");
    }
  }

  @Test
  void searchesAreTrimmedBeforeTheirLengthIsChecked() {
    String longest = "a".repeat(200);
    assertThat(new PageRequest(0, 20, "  tax \t").search()).isEqualTo("tax");
    assertThat(new PageRequest(0, 20, " \n ").search()).isEmpty();
    assertThat(new PageRequest(0, 20, "  " + longest + "  ").search()).isEqualTo(longest);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new PageRequest(0, 20, longest + "a"))
        .withMessage("Search is limited to 200 characters");
  }

  @Test
  void boundsAreReportedBeforeTheSearchLength() {
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new PageRequest(-1, 20, "a".repeat(201)))
        .withMessage("Use offset >= 0 and limit from 1 to 100");
  }

  @Test
  void searchesTheDatabaseCouldNotHoldAreRejectedBeforeTrimming() {
    // PostgreSQL answered 500 for a NUL search parameter; a lone NUL was trimmed away silently.
    for (String search : List.of("a\0b", "\0tax", "\0"))
      assertThatIllegalArgumentException()
          .isThrownBy(() -> new PageRequest(0, 20, search))
          .withMessage("Text cannot contain the NUL character (U+0000)");
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new PageRequest(0, 20, "a\ud800"))
        .withMessage("Text cannot contain an unpaired UTF-16 surrogate");
    assertThat(new PageRequest(0, 20, " 😀 ").search()).isEqualTo("😀");
  }
}
