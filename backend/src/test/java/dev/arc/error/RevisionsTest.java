package dev.arc.error;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * One revision policy for rules and sources: a missing revision is malformed (422), a stale one is
 * a conflict (409) with the resource's own message, and the current one passes.
 */
class RevisionsTest {
  @Test
  void aMissingRevisionIsMalformedAndAStaleOneIsAConflictWithTheGivenMessage() {
    assertThatThrownBy(() -> Revisions.require(4, null, "Source changed"))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage()).isEqualTo("Revision is required");
            });
    assertThatThrownBy(() -> Revisions.require(4, 3, "Source changed in another editor"))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(409);
              assertThat(error.getMessage()).isEqualTo("Source changed in another editor");
              assertThat(error.issues()).containsExactly("Source changed in another editor");
            });
    assertThatCode(() -> Revisions.require(4, 4, "unused")).doesNotThrowAnyException();
  }
}
