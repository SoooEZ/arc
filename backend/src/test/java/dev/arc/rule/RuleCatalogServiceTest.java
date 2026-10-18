package dev.arc.rule;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.node;
import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Node;
import dev.arc.model.RuleCaller;
import dev.arc.model.RuleCaller.Published;
import dev.arc.model.RuleKind;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class RuleCatalogServiceTest {
  private final RuleCatalog catalog = mock(RuleCatalog.class);
  private final RuleCatalogService service = new RuleCatalogService(catalog);

  /** The catalog filter keeps the kind as text; an unknown one is a 422, never a 400. */
  @Test
  void unknownKindsAreRefusedByTheCatalogFilter() {
    var page = new dev.arc.model.PageRequest(0, 20, "");
    for (String kind : List.of("formula", "LOOP"))
      assertThatThrownBy(() -> service.catalog(page, kind, false))
          .as(kind)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).isEqualTo("Unknown rule kind");
              });
    verify(catalog, never()).catalog(any(), anyString(), anyBoolean());
    for (RuleKind kind : RuleKind.values()) service.catalog(page, kind.name(), false);
    service.catalog(page, "", true);
    verify(catalog).catalog(page, "", true);
  }

  /**
   * Each caller lists the versions its saved draft and its latest published version pin, read from
   * their definitions one at a time; a caller whose only calls are earlier versions is counted
   * without a read, and an unpinned Reference names the rule with no version.
   */
  @Test
  void callersListThePinsOfEachDraftAndLatestVersion() {
    var page = new dev.arc.model.PageRequest(0, 20, "");
    when(catalog.callingRules("rates", page))
        .thenReturn(
            new dev.arc.model.CatalogPage<>(
                List.of(
                    new RuleCatalog.CallingRule("checkout", "Checkout", 3, true, true, 2),
                    new RuleCatalog.CallingRule("drafts", "Drafts", null, true, false, 0),
                    new RuleCatalog.CallingRule("legacy", "Legacy", 4, false, false, 1)),
                3,
                0,
                20));
    Node v2 = nodeOf("tax", "REFERENCE", "Tax").rule("rates", 2).output("tax").build();
    var draftDefinition =
        new Definition(
            1,
            List.of(),
            List.of(inputNode("in", "Input"), v2, node("calc", "FORMULA", "@rates:1(1)", "x")),
            List.of());
    Node v1 = nodeOf("tax", "REFERENCE", "Tax").rule("rates", 1).output("tax").build();
    Node unpinned = nodeOf("tax", "REFERENCE", "Tax").rule("rates", null).output("tax").build();
    when(catalog.callingDefinition("checkout", null, "rates"))
        .thenReturn(Optional.of(draftDefinition));
    when(catalog.callingDefinition("checkout", 3, "rates")).thenReturn(Optional.of(graphWith(v1)));
    when(catalog.callingDefinition("drafts", null, "rates"))
        .thenReturn(Optional.of(graphWith(unpinned)));

    var callers = service.callers("rates", page);

    assertThat(callers.total()).isEqualTo(3);
    assertThat(callers.items())
        .containsExactly(
            new RuleCaller("checkout", "Checkout", List.of(1, 2), new Published(3, List.of(1)), 2),
            new RuleCaller("drafts", "Drafts", List.of(), null, 0),
            new RuleCaller("legacy", "Legacy", null, null, 1));
    verify(catalog, never()).callingDefinition(eq("legacy"), any(), anyString());
  }

  /** A caller that stops calling the rule between the page and its reads shows no pins. */
  @Test
  void aCallerThatStopsCallingBetweenTheReadsHasNoPins() {
    var page = new dev.arc.model.PageRequest(0, 20, "");
    when(catalog.callingRules("rates", page))
        .thenReturn(
            new dev.arc.model.CatalogPage<>(
                List.of(new RuleCatalog.CallingRule("checkout", "Checkout", 3, true, true, 0)),
                1,
                0,
                20));
    when(catalog.callingDefinition(eq("checkout"), any(), eq("rates")))
        .thenReturn(Optional.empty());

    assertThat(service.callers("rates", page).items())
        .containsExactly(new RuleCaller("checkout", "Checkout", null, null, 0));
  }

  private static Definition graphWith(Node node) {
    return new Definition(1, List.of(), List.of(inputNode("in", "Input"), node), List.of());
  }
}
