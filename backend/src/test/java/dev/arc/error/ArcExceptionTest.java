package dev.arc.error;

import static org.assertj.core.api.Assertions.*;

import dev.arc.error.ArcException.Kind;
import java.util.List;
import org.junit.jupiter.api.Test;

class ArcExceptionTest {
  @Test
  void factoriesSetTheStatusAndKindWithoutChangingTheMessageOrIssues() {
    record Expected(ArcException error, int status, Kind kind, boolean recoverable) {}
    for (var expected :
        List.of(
            new Expected(ArcException.invalid("bad"), 422, Kind.INVALID, true),
            new Expected(ArcException.notAvailable("bad"), 422, Kind.NOT_AVAILABLE, true),
            new Expected(ArcException.limit("bad"), 422, Kind.LIMIT, false),
            new Expected(ArcException.deadline("bad"), 504, Kind.DEADLINE, false),
            new Expected(
                ArcException.invalid("bad").asDefinitionFailure(), 422, Kind.DEFINITION, false))) {
      var error = expected.error();
      assertThat(error.status()).as(expected.kind().name()).isEqualTo(expected.status());
      assertThat(error.kind()).isEqualTo(expected.kind());
      assertThat(error.recoverable()).as(expected.kind().name()).isEqualTo(expected.recoverable());
      assertThat(error.getMessage()).isEqualTo("bad");
      assertThat(error.issues()).containsExactly("bad");
      assertThat(error.locations()).isEmpty();
    }
  }

  @Test
  void publicConstructorsTreatOnly504AsTheDeadline() {
    assertThat(new ArcException(504, "late").kind()).isEqualTo(Kind.DEADLINE);
    assertThat(new ArcException(504, "late", List.of("a", "b")).recoverable()).isFalse();
    for (int status : new int[] {400, 404, 409, 422, 500}) {
      var error = new ArcException(status, "failed");
      assertThat(error.kind()).as("status " + status).isEqualTo(Kind.INVALID);
      assertThat(error.recoverable()).as("status " + status).isTrue();
    }
  }

  @Test
  void aDefinitionFailureReKindsOnlyRecoverableErrors() {
    var located = ArcException.invalid("bad").atNode("rule", 1, "node", "Node");
    var definition = located.asDefinitionFailure();
    assertThat(definition.kind()).isEqualTo(Kind.DEFINITION);
    assertThat(definition.recoverable()).isFalse();
    assertThat(definition.status()).isEqualTo(422);
    assertThat(definition.getMessage()).isEqualTo("bad");
    assertThat(definition.issues()).containsExactly("bad");
    assertThat(definition.locations()).isEqualTo(located.locations());
    assertThat(new ArcException(404, "missing").asDefinitionFailure().kind())
        .isEqualTo(Kind.DEFINITION);
    assertThat(ArcException.notAvailable("#N/A").asDefinitionFailure().kind())
        .isEqualTo(Kind.DEFINITION);
    for (var kept : List.of(ArcException.limit("steps"), ArcException.deadline("late")))
      assertThat(kept.asDefinitionFailure()).isSameAs(kept);
  }

  @Test
  void locationsAndContextKeepTheKind() {
    for (var original :
        List.of(
            ArcException.invalid("bad"),
            ArcException.invalid("bad").asDefinitionFailure(),
            ArcException.notAvailable("MATCH: #N/A"),
            ArcException.limit("Execution exceeds 1,000 steps"),
            ArcException.deadline("Rule execution deadline exceeded"))) {
      var located =
          original
              .atNode(null, null, "node", "Node")
              .inRule("rule", 2)
              .withContext("Field total")
              .atNode("parent", 1, "call", "Call");
      assertThat(located.kind()).isEqualTo(original.kind());
      assertThat(located.status()).isEqualTo(original.status());
      assertThat(located.getMessage()).isEqualTo("Field total: " + original.getMessage());
      assertThat(located.issues()).containsExactly("Field total: " + original.getMessage());
      assertThat(located.locations())
          .containsExactly(
              new ArcException.Location("rule", 2, "node", "Node"),
              new ArcException.Location("parent", 1, "call", "Call"));
    }
  }
}
