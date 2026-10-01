package dev.arc.source;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.DataSource;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Input;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.SourceBinding;
import dev.arc.model.SourceDefinition;
import dev.arc.source.SourceBindingValidator.CalleeCheck;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceBindingValidatorTest {
  private final SourceRepository repository = mock(SourceRepository.class);
  private final SourceBindingValidator validator =
      new SourceBindingValidator(new SourceVersions(repository));
  private final RuleResolver noRules =
      (id, version) -> {
        throw new AssertionError("Unexpected rule read");
      };
  private final Input sourced =
      new Input(
          "amount",
          "NUMBER",
          false,
          null,
          new SourceBinding("rates", 1, Map.of("wrong", "1"), null, "FAIL"));

  SourceBindingValidatorTest() {
    var rates =
        new SourceDefinition(
            "LOOKUP", null, List.of(new Input("key", "STRING", true, null)), Map.of(), null, 1000);
    when(repository.get("rates", 1)).thenReturn(new DataSource("rates", "Rates", 1, rates));
  }

  private Definition draft(List<Node> nodes) {
    return new Definition(1, List.of(sourced), nodes, List.of());
  }

  @Test
  void mappingProblemsAppearOnTheInputNodeAndADraftWithoutOneStillGetsTheProblem() {
    var withInput = draft(List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")));
    assertThatThrownBy(() -> validator.validatePinnedContracts(withInput, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo("Unknown source parameter: wrong");
              assertThat(error.locations())
                  .containsExactly(new Location(null, null, "in", "Inputs"));
            });

    var withoutInput = draft(List.of(outputNode("out", "Out", "1")));
    assertThatThrownBy(() -> validator.validatePinnedContracts(withoutInput, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.status()).isEqualTo(422);
              assertThat(error.getMessage()).isEqualTo("Unknown source parameter: wrong");
              assertThat(error.locations()).isEmpty();
            });
  }

  @Test
  void theNestingLimitIsCheckedOnEveryPathWhateverTheNodeOrder() {
    // With one visit per pin, m's child c0 was skipped as already visited at depth 1, so the root
    // was accepted and published, then failed every execution with the nesting limit.
    var rules = new HashMap<String, Definition>();
    for (int level = 0; level <= 15; level++)
      rules.put("c" + level, level == 15 ? leaf() : referencing("c" + (level + 1)));
    rules.put("m", referencing("c0"));
    RuleResolver resolver = (id, version) -> rules.get(id);
    var direct = nodeOf("direct", "REFERENCE", "Direct").rule("c0", 1).output("a").build();
    var viaM = nodeOf("via", "REFERENCE", "Via").rule("m", 1).output("b").build();
    for (List<Node> order : List.of(List.of(direct, viaM), List.of(viaM, direct))) {
      var nodes = new ArrayList<Node>(List.of(inputNode("in", "Inputs")));
      nodes.addAll(order);
      nodes.add(outputNode("out", "Out", "1"));
      var root = new Definition(1, List.of(), nodes, List.of());
      assertThatThrownBy(() -> validator.validatePinnedContracts(root, resolver))
          .as(order.toString())
          .hasMessage("Rule nesting exceeds 16 levels");
    }
    // A chain of exactly 16 levels below the root is accepted (lesson B3: both sides).
    var deepest =
        new Definition(
            1,
            List.of(),
            List.of(inputNode("in", "Inputs"), direct, outputNode("out", "Out", "1")),
            List.of());
    validator.validatePinnedContracts(deepest, resolver);
  }

  /**
   * The three entry points differ in where configurations come from and which pins are walked:
   * execution reads only the session it is given, and diagnostics walk only the pins the graph
   * checks have not reported.
   */
  @Test
  void executionReadsOnlyItsSessionAndDiagnosticsWalkOnlyTheUnreportedPins() {
    var rates =
        new SourceDefinition(
            "LOOKUP", null, List.of(new Input("key", "STRING", true, null)), Map.of(), null, 1000);
    var mapped =
        new Input(
            "amount",
            "NUMBER",
            false,
            null,
            new SourceBinding("rates", 1, Map.of("key", "\"US\""), null, "FAIL"));
    var root =
        new Definition(
            1,
            List.of(mapped),
            List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")),
            List.of());
    var sessionReads = new ArrayList<String>();
    SourceConfigurations session =
        (id, version) -> {
          sessionReads.add(id + "@" + version);
          return rates;
        };
    validator.validateForExecution(root, noRules, session);
    assertThat(sessionReads).containsExactly("rates@1");
    verifyNoInteractions(repository);

    when(repository.get("rates", 1)).thenReturn(new DataSource("rates", "Rates", 1, rates));
    var resolved = new ArrayList<String>();
    RuleResolver counting =
        (id, version) -> {
          resolved.add(id + "@" + version);
          return leaf();
        };
    var reported = nodeOf("reported", "REFERENCE", "Reported").rule("bad", 1).output("a").build();
    var walked = nodeOf("walked", "REFERENCE", "Walked").rule("good", 1).output("b").build();
    var withPins =
        new Definition(
            1,
            List.of(mapped),
            List.of(inputNode("in", "Inputs"), reported, walked, outputNode("out", "Out", "1")),
            List.of());
    var unreported = List.of(Validator.dependencies(withPins).get(1));
    assertThat(unreported.getFirst().ruleId()).isEqualTo("good");
    validator.validateRemainingPins(withPins, counting, unreported, CalleeCheck.NONE);
    assertThat(resolved).containsExactly("good@1");
    verify(repository).get("rates", 1);
  }

  /**
   * "A caller must supply this parameter" is one rule (Definition.Input.needsCallerValue): the
   * static mapping check and the runtime normalization agree for every declaration a source
   * parameter can have.
   */
  @Test
  void staticMappingChecksAndRuntimeNormalizationAgreeOnRequiredParameters() {
    var adapter = mock(SourceAdapter.class);
    when(adapter.kind()).thenReturn("LOOKUP");
    when(adapter.fetch(any(), any(), any(), any())).thenReturn("value");
    for (boolean required : new boolean[] {true, false})
      for (Object defaultValue : java.util.Arrays.asList(null, "US")) {
        // Each declaration stands for another version of "table"; versions are frozen once read.
        var versions = new SourceVersions(repository);
        var validator = new SourceBindingValidator(versions);
        var execution =
            new SourceExecutionService(
                repository,
                versions,
                new SourceAdapters(List.of(adapter)),
                new JsonPointerExtractor());
        var parameter = new Input("key", "STRING", required, defaultValue);
        var table = new SourceDefinition("LOOKUP", null, List.of(parameter), Map.of(), null, 1000);
        when(repository.get("table", 1)).thenReturn(new DataSource("table", "Table", 1, table));
        var unmapped =
            new Input(
                "amount",
                "NUMBER",
                false,
                null,
                new SourceBinding("table", 1, Map.of(), null, "FAIL"));
        var graph =
            new Definition(
                1,
                List.of(unmapped),
                List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")),
                List.of());
        boolean mustMap = parameter.needsCallerValue();
        assertThat(mustMap).as(parameter.toString()).isEqualTo(required && defaultValue == null);
        if (mustMap) {
          assertThatThrownBy(() -> validator.validatePinnedContracts(graph, noRules))
              .as(parameter.toString())
              .hasMessage("amount: missing source mapping for key");
          assertThatThrownBy(
                  () -> execution.test("table", new SourceExecutionService.Test(Map.of(), 1)))
              .as(parameter.toString())
              .hasMessage("Missing source parameter: key");
        } else {
          validator.validatePinnedContracts(graph, noRules);
          assertThat(execution.test("table", new SourceExecutionService.Test(Map.of(), 1)))
              .as(parameter.toString())
              .isEqualTo("value");
        }
      }
  }

  /**
   * Validate, diagnostics and publish read a pinned version through the frozen versions that
   * executions keep, so repeated checks of an immutable version read it once per process; each
   * check used to read and decode it again.
   */
  @Test
  void staticChecksReadAPinnedVersionOncePerProcess() {
    var mapped =
        new Input(
            "amount",
            "NUMBER",
            false,
            null,
            new SourceBinding("rates", 1, Map.of("key", "\"US\""), null, "FAIL"));
    var definition =
        new Definition(
            1,
            List.of(mapped),
            List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "amount")),
            List.of());
    for (int check = 0; check < 3; check++) validator.validatePinnedContracts(definition, noRules);
    verify(repository, times(1)).get("rates", 1);
  }

  private static Definition referencing(String ruleId) {
    return new Definition(
        1,
        List.of(),
        List.of(
            inputNode("in", "Inputs"),
            nodeOf("ref", "REFERENCE", "Ref").rule(ruleId, 1).output("r").build(),
            outputNode("out", "Out", "r")),
        List.of());
  }

  private static Definition leaf() {
    return new Definition(
        1, List.of(), List.of(inputNode("in", "Inputs"), outputNode("out", "Out", "1")), List.of());
  }
}
