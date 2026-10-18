package dev.arc.engine.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Which declared name a "did you mean …?" hint offers for an unknown one, if any. */
class NameSuggestionsTest {
  @Test
  void oneEditAwayIsSuggested() {
    // A deletion, an insertion, a substitution and a swap of neighbours each count once.
    assertThat(NameSuggestions.closest("amont", List.of("orderTotal", "amount")))
        .isEqualTo("amount");
    assertThat(NameSuggestions.closest("amounnt", List.of("amount"))).isEqualTo("amount");
    assertThat(NameSuggestions.closest("rote", List.of("rate"))).isEqualTo("rate");
    assertThat(NameSuggestions.closest("rtae", List.of("rate"))).isEqualTo("rate");
    assertThat(NameSuggestions.edits("rtae", "rate", 2)).isEqualTo(1);
  }

  /** A different case alone is a match however many letters differ, and the closest one. */
  @Test
  void aNameInAnotherCaseIsTheClosest() {
    assertThat(NameSuggestions.closest("ORDERTOTAL", List.of("orderTotal")))
        .isEqualTo("orderTotal");
    assertThat(NameSuggestions.edits("ORDERTOTAL", "orderTotal", 2)).isGreaterThan(2);
    // "Amounts" is one edit away and declared first; "amount" differs only in case.
    assertThat(NameSuggestions.closest("Amount", List.of("Amounts", "amount"))).isEqualTo("amount");
  }

  /** Two edits turn most short names into each other, so only names of six or more allow them. */
  @Test
  void twoEditsAreAllowedOnlyForNamesOfSixOrMoreCharacters() {
    assertThat(NameSuggestions.closest("discnt", List.of("discount"))).isEqualTo("discount");
    assertThat(NameSuggestions.closest("amnts", List.of("amounts"))).isNull();
    assertThat(NameSuggestions.closest("amnt", List.of("amount"))).isNull();
    // Three edits are too many for any name.
    assertThat(NameSuggestions.closest("dscnts", List.of("discounts"))).isNull();
    assertThat(NameSuggestions.closest("total", List.of("amount", "rate"))).isNull();
  }

  /** Equally close names go to the one declared first; a closer one wins wherever it is. */
  @Test
  void aTieGoesToTheEarlierDeclaration() {
    assertThat(NameSuggestions.closest("rat", List.of("rate", "rad"))).isEqualTo("rate");
    assertThat(NameSuggestions.closest("rat", List.of("rad", "rate"))).isEqualTo("rad");
    // "amount" is two edits from "amonts", "amounts" one.
    assertThat(NameSuggestions.closest("amonts", List.of("amount", "amounts")))
        .isEqualTo("amounts");
  }
}
