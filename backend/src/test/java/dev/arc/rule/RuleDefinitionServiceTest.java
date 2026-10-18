package dev.arc.rule;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceBindingValidator;
import dev.arc.source.SourceRepository;
import dev.arc.source.SourceVersions;
import dev.arc.support.Engines;
import java.util.*;
import org.junit.jupiter.api.Test;

/** /api/diagnostics: graph problems and source contracts, each reported once by its owner. */
class RuleDefinitionServiceTest {
  private final RuleRepository rules = mock(RuleRepository.class);
  private final SourceRepository sources = mock(SourceRepository.class);
  private final Validator validator = new Validator();
  private final RuleDefinitionService service =
      new RuleDefinitionService(
          validator,
          rules,
          new SourceBindingValidator(new SourceVersions(sources)),
          Engines.engine(validator));

  private final Definition child =
      new Definition(
          1,
          List.of(),
          List.of(
              dev.arc.support.GraphFixtures.inputNode("in", "Input"),
              dev.arc.support.GraphFixtures.outputNode("o", "O", "2")),
          List.of(new Edge("next", "in", "o", "next")));
  private final Definition parent =
      new Definition(
          1,
          List.of(),
          List.of(
              dev.arc.support.GraphFixtures.inputNode("input", "Inputs"),
              nodeOf("ref", "REFERENCE", "Ref").rule("child", 1).output("r").build(),
              dev.arc.support.GraphFixtures.outputNode("out", "Out", "r")),
          List.of(new Edge("a", "input", "ref", "next"), new Edge("b", "ref", "out", "next")));

  /** The definitions a validator compiled, to tell a reused plan from a fresh compile. */
  private final List<Definition> compiled = new ArrayList<>();

  private final Validator counting =
      new Validator() {
        @Override
        public dev.arc.engine.validation.CompiledGraph compile(
            Definition definition, dev.arc.engine.RuleResolver resolver) {
          compiled.add(definition);
          return super.compile(definition, resolver);
        }
      };
  private final Engine countingEngine = Engines.engine(counting);
  private final RuleDefinitionService checks =
      new RuleDefinitionService(
          counting, rules, new SourceBindingValidator(new SourceVersions(sources)), countingEngine);

  /** How often a later execution has to read the child's version: 0 once a plan of it is cached. */
  private int readsOfChildByAnExecution() {
    var reads = new java.util.concurrent.atomic.AtomicInteger();
    countingEngine
        .session(rules, ExecutionDeadline.start(1000))
        .prepare(
            "child",
            1,
            () -> {
              reads.incrementAndGet();
              return child;
            });
    return reads.get();
  }

  /**
   * A publication's check reuses the plan an execution compiled for a pin, and stores none of its
   * own, because it may read versions its transaction has not committed. The sample seed publishes
   * apply-discount and then order-pricing in one transaction and rolls both back when a sample ID
   * is taken; the plan its check had cached then ran a version that did not exist, and later the
   * user's own apply-discount v1 (lesson B34).
   */
  @Test
  void aPublicationCheckReusesExecutionPlansAndStoresNone() {
    when(rules.resolve("child", 1)).thenReturn(child);
    checks.validateForPublication(parent);
    assertThat(readsOfChildByAnExecution()).as("the check stored no plan").isEqualTo(1);
    // The pin the execution compiled is neither compiled nor read from storage again.
    compiled.clear();
    clearInvocations(rules);
    for (int request = 0; request < 3; request++) checks.validateForPublication(parent);
    assertThat(compiled).filteredOn(child::equals).isEmpty();
    verify(rules, never()).resolve("child", 1);
  }

  /**
   * The editor's validate and diagnostics run outside any transaction and read committed versions
   * only, so they keep the plans of the pins they reach: every diagnostics request, sent 350 ms
   * after each edit, read, decoded and fully compiled every reached pin again until an execution or
   * preview had cached it.
   */
  @Test
  void editorChecksKeepThePlansOfThePinsTheyReach() {
    when(rules.resolve("child", 1)).thenReturn(child);
    assertThat(checks.diagnostics(parent)).isEmpty();
    verify(rules, times(1)).resolve("child", 1);
    assertThat(compiled).filteredOn(child::equals).hasSize(1);
    compiled.clear();
    clearInvocations(rules);
    for (int request = 0; request < 3; request++) {
      checks.validate(parent);
      assertThat(checks.diagnostics(parent)).isEmpty();
    }
    assertThat(compiled).filteredOn(child::equals).isEmpty();
    verify(rules, never()).resolve("child", 1);
    assertThat(readsOfChildByAnExecution()).as("an execution runs the check's plan").isZero();
  }

  /**
   * A check keeps a plan only while the generation it began in lasts: a version read before a
   * rule's deletion is never stored after it, so an ID used again never runs the deleted rule's
   * plan ({@code Engine.forget}, as for executions).
   */
  @Test
  void anEditorCheckThatBeganBeforeADeletionStoresNoPlanAfterIt() {
    when(rules.resolve("child", 1)).thenReturn(child);
    var resolver = new dev.arc.engine.MemoizingRuleResolver(countingEngine.cachedFirst(rules));
    var check = countingEngine.check(resolver);
    countingEngine.forget("child");
    check.prepare("child", 1, child);
    assertThat(readsOfChildByAnExecution()).as("the stale check stored no plan").isEqualTo(1);
    assertThat(readsOfChildByAnExecution()).as("the execution stored its plan").isZero();
  }

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
    assertThat(problems.getLast().message())
        .isEqualTo("value: choose what to pass as key to data source remote v1");
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
                "value: choose what to pass as key to data source remote v1",
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

  @Test
  void variablesDependOnTheGraphStructureAlone() {
    var inputs =
        List.of(
            new Input("amount", "NUMBER", true, null),
            new Input("items", "ARRAY", false, List.of()));
    var calc = node("calc", "FORMULA", "Calc", "amount * 2", "total");
    var valid = graph(calc, "total");
    var scopes = service.variables(new Definition(1, inputs, valid.nodes(), valid.edges()));
    assertThat(scopes).containsEntry("out", Set.of("amount", "items", "total"));
    // Before, one content problem anywhere made the whole read fail and blanked every inspector.
    var blankLabel =
        nodeOf("calc", "FORMULA", "").at(0, 0).expression("amount * 2").output("total").build();
    var legacyOutput =
        nodeOf("out", "OUTPUT", "Return").at(0, 0).expression("total").output("legacy").build();
    var variants = new LinkedHashMap<String, Definition>();
    variants.put(
        "blank label",
        new Definition(1, inputs, graph(blankLabel, "total").nodes(), valid.edges()));
    variants.put(
        "ARRAY default {}",
        new Definition(
            1,
            List.of(inputs.getFirst(), new Input("items", "ARRAY", false, Map.of())),
            valid.nodes(),
            valid.edges()));
    variants.put(
        "result variable on an Output",
        new Definition(
            1, inputs, List.of(valid.nodes().get(0), calc, legacyOutput), valid.edges()));
    for (var variant : variants.entrySet()) {
      assertThat(service.variables(variant.getValue())).as(variant.getKey()).isEqualTo(scopes);
      // The full draft shape still reports the problem where it is saved or diagnosed.
      assertThat(service.diagnostics(variant.getValue())).as(variant.getKey()).isNotEmpty();
    }
    // An input named like a reserved word (saved before the word was reserved) is content too:
    // the scope plan reads the name as text, so every node still reports its variables.
    var reserved =
        new Definition(
            1,
            List.of(new Input("and", "NUMBER", true, null), inputs.get(1)),
            valid.nodes(),
            valid.edges());
    assertThat(service.variables(reserved)).containsEntry("out", Set.of("and", "items", "total"));
    assertThat(service.diagnostics(reserved))
        .extracting(Validator.Problem::message)
        .containsExactly("Input names must be identifiers (letters, digits, underscores)");
    // Structure problems keep failing, as the API reference states.
    var missingTarget =
        new Definition(
            1, inputs, valid.nodes(), List.of(new Edge("gone", "input", "nowhere", "next")));
    assertThatThrownBy(() -> service.variables(missingTarget))
        .hasMessage("Connection refers to a missing node");
    var duplicate =
        new Definition(1, inputs, List.of(valid.nodes().get(0), calc, calc), valid.edges());
    assertThatThrownBy(() -> service.variables(duplicate)).hasMessage("Duplicate node ID: calc");
    var backEdges = new ArrayList<>(valid.edges());
    backEdges.add(new Edge("back", "out", "calc", "next"));
    var cycle = new Definition(1, inputs, valid.nodes(), backEdges);
    assertThatThrownBy(() -> service.variables(cycle))
        .hasMessage("Decision graphs cannot contain cycles");
  }

  /**
   * An input whose required flag was left out of the request (or sent as null) is a draft-shape
   * problem reported on the Input node, for the editor's check and its diagnostics alike; read as
   * optional, it passed every check and ran the graph with a null amount (lesson B29).
   */
  @Test
  void anInputWithoutARequiredFlagFailsTheShapeCheckOnTheInputNode() {
    var valid = graph(null, "amount");
    var undeclared =
        new Definition(
            1,
            List.of(new Input("amount", "NUMBER", null, null, null)),
            valid.nodes(),
            valid.edges());
    var expected =
        new Validator.Problem(
            "Declare whether input amount is required (true or false)",
            List.of(new Location(null, null, "input", "Inputs")));
    assertThatThrownBy(() -> service.validate(undeclared))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(Validator.Problem.from(error)).isEqualTo(expected);
            });
    assertThat(service.diagnostics(undeclared)).containsExactly(expected);
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

  @Test
  void validateAndDiagnosticsRefuseAPinnedVersionThatNoLongerPrepares() {
    var amount = List.of(new Input("amount", "NUMBER", true, null));
    var next = List.of(new Edge("next", "in", "out", "next"));
    // Stored before unused properties were rejected: an Output with a result variable.
    var stale =
        new Definition(
            1,
            amount,
            List.of(
                node("in", "INPUT", "Input", null, null),
                node("out", "OUTPUT", "Out", "amount", "r")),
            next);
    when(rules.resolve("child", 1)).thenReturn(stale);
    when(rules.resolveFormula("child", 1)).thenReturn(stale);
    var reference =
        nodeOf("ref", "REFERENCE", "Ref")
            .at(0, 0)
            .rule("child", 1)
            .bindings(Map.of("amount", "amount"))
            .output("r")
            .build();
    String message = "Result variables belong to Formula, Transform and Reference nodes";
    for (Definition parent : List.of(graph(reference, "r"), graph(null, "@child:1(amount)"))) {
      // These passed every static check and publish, then failed every execution of the parent.
      assertThatThrownBy(() -> service.validate(parent))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo(message);
                assertThat(error.locations())
                    .first()
                    .isEqualTo(new Location("child", 1, "out", "Out"));
                assertThat(error.locations()).last().extracting(Location::ruleId).isNull();
              });
      assertThat(service.diagnostics(parent))
          .singleElement()
          .satisfies(
              problem -> {
                assertThat(problem.message()).isEqualTo(message);
                assertThat(problem.locations())
                    .first()
                    .isEqualTo(new Location("child", 1, "out", "Out"));
              });
    }
    var healthy =
        new Definition(
            1,
            amount,
            List.of(
                node("in", "INPUT", "Input", null, null),
                node("out", "OUTPUT", "Out", "amount", null)),
            next);
    when(rules.resolve("child", 1)).thenReturn(healthy);
    when(rules.resolveFormula("child", 1)).thenReturn(healthy);
    service.validate(graph(reference, "r"));
    assertThat(service.diagnostics(graph(null, "@child:1(amount)"))).isEmpty();
  }
}
