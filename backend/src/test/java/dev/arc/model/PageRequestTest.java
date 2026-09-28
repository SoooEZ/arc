package dev.arc.model;

import static org.assertj.core.api.Assertions.*;

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
}
