package dev.arc.rule;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceRepository;
import java.util.*;
import org.junit.jupiter.api.Test;

/** /api/diagnostics: graph problems and source contracts, each reported once by its owner. */
class RuleDefinitionServiceTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final RuleDefinitionService service =
      new RuleDefinitionService(new Validator(), rules, new SourceBindingValidator(sources));

  @Test
  void formulaCallPinAndSyntaxProblemsAreReportedOnceWithTheirLabel() {
    when(rules.resolveFormula(anyString(), anyInt()))
        .thenAnswer(call -> missingFormula(call.getArgument(0), call.getArgument(1)));
    var missing = service.diagnostics(graph(null, "@missing:1(amount)"));
    assertThat(missing)
        .containsExactly(atReturn("Return: Published Formula version not found: missing v1"));
    verify(rules, times(1)).resolveFormula("missing", 1);

    assertThat(service.diagnostics(graph(null, "@missing(amount)")))
        .extracting(Validator.Problem::message)
        .singleElement()
        .asString()
        .startsWith("Return: ");
    assertThat(service.diagnostics(graph(null, "@tax:1(amount")))
        .extracting(Validator.Problem::message)
        .singleElement()
        .asString()
        .startsWith("Return: ");
    var calculation = node("calc", "FORMULA", "Calc", "@missing:2(amount) + 1", "total");
    assertThat(service.diagnostics(graph(calculation, "total")))
        .containsExactly(
            new Validator.Problem(
                "Calc: Published Formula version not found: missing v2",
                List.of(new Location(null, null, "calc", "Calc"))));
  }

  @Test
  void aMissingReferenceIsReportedOnceAndLooksUpItsPinOnce() {
    when(rules.version(anyString(), anyInt()))
        .thenThrow(new ArcException(404, "Published rule version not found: missing v1"));
    when(rules.resolve(anyString(), anyInt())).thenCallRealMethod();
    var reference =
        nodeOf("reuse", "REFERENCE", "Reuse")
            .at(0, 0)
            .output("value")
            .rule("missing", 1)
            .bindings(Map.of())
            .build();

    assertThat(service.diagnostics(graph(reference, "value")))
        .containsExactly(
            new Validator.Problem(
                "Published rule version not found: missing v1",
                List.of(new Location(null, null, "reuse", "Reuse"))));
    verify(rules, times(1)).version("missing", 1);
  }

  @Test
  void aMalformedCallNoLongerHidesAnotherCallsSourceContract() {
    var child = childWithUnmappedSource();
    when(rules.resolveFormula("child", 1)).thenReturn(child);
    var malformed = node("calc", "FORMULA", "Calc", "@x:1(", "total");

    var problems = service.diagnostics(graph(malformed, "@child:1()"));

    assertThat(problems).extracting(Validator.Problem::message).hasSize(2);
    assertThat(problems.getFirst().message()).startsWith("Calc: ");
    assertThat(problems.getLast().message()).isEqualTo("value: missing source mapping for key");
    assertThat(problems.getLast().locations())
        .containsExactly(
            new Location("child", 1, "in", "Input"), new Location(null, null, "out", "Return"));
    verify(rules, never()).resolveFormula(eq("x"), anyInt());
  }

  @Test
  void referencesInCyclicDraftsStillHaveTheirSourceContractsChecked() {
    var child = childWithUnmappedSource();
    when(rules.resolve("child", 1)).thenReturn(child);
    var reference =
        nodeOf("reuse", "REFERENCE", "Reuse")
            .at(0, 0)
            .output("value")
            .rule("child", 1)
            .bindings(Map.of())
            .build();
    var loop = node("calc", "FORMULA", "Calc", "value + 1", "total");
    var draft =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", "Inputs", null, null),
                reference,
                loop,
                node("out", "OUTPUT", "Return", "total", null)),
            List.of(
                new Edge("enter", "input", "reuse", "next"),
                new Edge("compute", "reuse", "calc", "next"),
                new Edge("repeat", "calc", "reuse", "next"),
                new Edge("finish", "calc", "out", "next")));

    var problems = service.diagnostics(draft);

    assertThat(problems).anyMatch(problem -> problem.message().contains("cycles"));
    assertThat(problems)
        .contains(
            new Validator.Problem(
                "value: missing source mapping for key",
                List.of(
                    new Location("child", 1, "in", "Input"),
                    new Location(null, null, "reuse", "Reuse"))));
  }

  @Test
  void anInvalidDraftShapeSkipsSourceContracts() {
    var shapeless = graph(null, "1");
    var nodes = new ArrayList<>(shapeless.nodes());
    nodes.add(node("bad id", "OUTPUT", "Bad", "1", null));
    var problems =
        service.diagnostics(new Definition(1, shapeless.inputs(), nodes, shapeless.edges()));
    assertThat(problems)
        .containsExactly(
            new Validator.Problem(
                "Every node needs a valid ID", List.of(new Location(null, null, "bad id", "Bad"))));
    verifyNoInteractions(sources);
  }

  /** A published child whose input reads an HTTP source without mapping its required key. */
  private Definition childWithUnmappedSource() {
    var remote =
        new SourceDefinition(
            "HTTP",
            "https://example.test/data",
            List.of(new Input("key", "STRING", true, null)),
            null,
            null,
            500);
    when(sources.get("remote", 1)).thenReturn(new DataSource("remote", "Remote", 1, remote));
    return new Definition(
        1,
        List.of(
            new Input(
                "value",
                "NUMBER",
                true,
                null,
                new SourceBinding("remote", 1, Map.of(), "", "FAIL"))),
        List.of(node("in", "INPUT", "Input", null, null), node("o", "OUTPUT", "O", "value", null)),
        List.of(new Edge("next", "in", "o", "next")));
  }

  private static Object missingFormula(String id, int version) {
    throw new ArcException(404, "Published Formula version not found: " + id + " v" + version);
  }

  private static Validator.Problem atReturn(String message) {
    return new Validator.Problem(message, List.of(new Location(null, null, "out", "Return")));
  }

  private static Node node(String id, String type, String label, String expression, String output) {
    return nodeOf(id, type, label).at(0, 0).expression(expression).output(output).build();
  }

  /** Input → optional middle node → Output "Return". */
  private static Definition graph(Node middle, String returned) {
    var nodes = new ArrayList<Node>(List.of(node("input", "INPUT", "Inputs", null, null)));
    var edges = new ArrayList<Edge>();
    String previous = "input";
    if (middle != null) {
      nodes.add(middle);
      edges.add(new Edge("to-" + middle.id(), previous, middle.id(), "next"));
      previous = middle.id();
    }
    nodes.add(node("out", "OUTPUT", "Return", returned, null));
    edges.add(new Edge("to-out", previous, "out", "next"));
    return new Definition(1, List.of(new Input("amount", "NUMBER", true, null)), nodes, edges);
  }
}
