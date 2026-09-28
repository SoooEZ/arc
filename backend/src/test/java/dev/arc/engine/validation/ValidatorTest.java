package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleSamples;
import java.util.*;
import org.junit.jupiter.api.Test;

class ValidatorTest {
  private final Validator validator = new Validator();
  private final RuleResolver resolver =
      (id, version) -> {
        throw new ArcException(404, "Published version not found");
      };

  @Test
  void templatesAreValid() {
    for (String kind : List.of("FORMULA", "RULE", "DECISION_TREE"))
      validator.validate(RuleSamples.blank(kind), resolver);
  }

  @Test
  void incompleteDraftsCanBeSavedButNotPublished() {
    var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null)), List.of());
    validator.shape(d);
    assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("connect");
  }

  @Test
  void cyclesAndDisconnectedNodesAreRejected() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(node("input", "INPUT", null, null), node("loop", "FORMULA", "1", "x")),
            List.of(edge("input", "loop", "next"), edge("loop", "loop", "next")));
    assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("cycles");
    var base = RuleSamples.blank("FORMULA");
    var nodes = new ArrayList<>(base.nodes());
    nodes.add(node("orphan", "OUTPUT", "0", null));
    assertThatThrownBy(
            () ->
                validator.validate(new Definition(1, base.inputs(), nodes, base.edges()), resolver))
        .hasMessageContaining("reachable");
  }

  @Test
  void variablesMustExistOnEveryIncomingPath() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                node("test", "CONDITION", "true", null),
                node("calculation", "FORMULA", "10", "x"),
                node("result", "OUTPUT", "x", null)),
            List.of(
                edge("input", "test", "next"),
                edge("test", "calculation", "true"),
                edge("test", "result", "false"),
                edge("calculation", "result", "next")));
    assertThatThrownBy(() -> validator.validate(d, resolver))
        .hasMessageContaining("unavailable on every incoming path: x");
  }

  @Test
  void bothBranchesMayAssignTheSameResult() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                node("test", "CONDITION", "true", null),
                node("a", "FORMULA", "10", "x"),
                node("b", "FORMULA", "20", "x"),
                node("result", "OUTPUT", "x", null)),
            List.of(
                edge("input", "test", "next"),
                edge("test", "a", "true"),
                edge("test", "b", "false"),
                edge("a", "result", "next"),
                edge("b", "result", "next")));
    assertThatCode(() -> validator.validate(d, resolver)).doesNotThrowAnyException();
  }

  @Test
  void duplicateAndInvalidInputsAreRejected() {
    var base = RuleSamples.blank("FORMULA");
    assertThatThrownBy(
            () ->
                validator.shape(
                    new Definition(
                        1,
                        List.of(new Input("true", "NUMBER", true, null)),
                        base.nodes(),
                        base.edges())))
        .hasMessageContaining("identifiers");
    assertThatThrownBy(
            () ->
                validator.shape(
                    new Definition(
                        1,
                        List.of(new Input("amount", "NUMBER", true, "bad")),
                        base.nodes(),
                        base.edges())))
        .hasMessageContaining("must be number");
    assertThatThrownBy(
            () -> validator.shape(new Definition(2, base.inputs(), base.nodes(), base.edges())))
        .hasMessageContaining("schemaVersion");
  }

  @Test
  void inputNamesRejectWhitespaceAndFunctionPrefixesWithoutReservingFunctionNames() {
    var base = RuleSamples.blank("FORMULA");
    for (String name :
        List.of("unit price", "price\t", "price\u00a0", "$ROUND", "round$", "@price", "price@")) {
      var definition =
          new Definition(
              1, List.of(new Input(name, "NUMBER", true, null)), base.nodes(), base.edges());
      assertThatThrownBy(() -> validator.shape(definition))
          .as(name)
          .hasMessageContaining("identifiers");
    }
    validator.shape(
        new Definition(
            1, List.of(new Input("ROUND", "NUMBER", true, null)), base.nodes(), base.edges()));
  }

  @Test
  void suppliedResultNamesAreCheckedEvenInIncompleteDrafts() {
    for (String type : List.of("FORMULA", "TRANSFORM", "REFERENCE")) {
      for (String name :
          List.of(
              "unit price",
              "price\t",
              "price\u00a0",
              "$value",
              "value$",
              "@value",
              "value@",
              "true",
              "a".repeat(65))) {
        var definition =
            new Definition(1, List.of(), List.of(node("result", type, null, name)), List.of());
        assertThatThrownBy(() -> validator.shape(definition))
            .as(type + " " + name)
            .isInstanceOfSatisfying(
                ArcException.class,
                failure -> {
                  assertThat(failure.getMessage()).contains("valid result variable");
                  assertThat(failure.locations())
                      .extracting(ArcException.Location::nodeId)
                      .containsExactly("result");
                });
        assertThat(validator.diagnostics(definition, resolver))
            .extracting(Validator.Problem::message)
            .containsExactly("result: provide a valid result variable");
      }
      for (String name : Arrays.asList(null, "", "ROUND", "_result2", "a".repeat(64)))
        validator.shape(
            new Definition(1, List.of(), List.of(node("result", type, null, name)), List.of()));
    }
  }

  @Test
  void parameterMappingKeysUseTheSameIdentifierPolicy() {
    for (String name : List.of("unit price", "$value", "@value")) {
      var reference =
          nodeOf("ref", "REFERENCE", "Ref")
              .output("result")
              .rule("child", 1)
              .bindings(Map.of(name, "1"))
              .build();
      assertThatThrownBy(
              () -> validator.shape(new Definition(1, List.of(), List.of(reference), List.of())))
          .hasMessageContaining("Invalid parameter binding");
      var source = new SourceBinding("source", 1, Map.of(name, "1"), null, "FAIL");
      var input = new Input("value", "NUMBER", true, null, source);
      assertThatThrownBy(
              () ->
                  validator.shape(
                      new Definition(
                          1,
                          List.of(input),
                          List.of(node("input", "INPUT", null, null)),
                          List.of())))
          .hasMessageContaining("Invalid source mapping");
    }
  }

  @Test
  void referencesMustExistAndBindRequiredInputs() {
    var ref =
        nodeOf("reuse", "REFERENCE", "reuse")
            .at(0, 0)
            .output("value")
            .rule("missing", 1)
            .bindings(Map.of())
            .build();
    var d =
        new Definition(
            1,
            List.of(),
            List.of(node("input", "INPUT", null, null), ref, node("out", "OUTPUT", "value", null)),
            List.of(edge("input", "reuse", "next"), edge("reuse", "out", "next")));
    assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("not found");
    var child =
        new Definition(
            1,
            List.of(new Input("amount", "NUMBER", true, null)),
            RuleSamples.blank("FORMULA").nodes(),
            RuleSamples.blank("FORMULA").edges());
    assertThatThrownBy(() -> validator.validate(d, (id, v) -> child))
        .hasMessageContaining("missing binding for amount");
  }

  @Test
  void cyclicGraphsStillDiagnoseSwitchAndTransformExpressions() {
    var decision =
        nodeOf("decision", "SWITCH", "Decision")
            .cases(List.of(new BranchCase("yes", "Yes", "1 +")))
            .build();
    var transform =
        nodeOf("transform", "TRANSFORM", "Transform")
            .output("data")
            .fields(List.of(new Field("name", "$UPPER(")))
            .build();
    var definition =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                decision,
                transform,
                node("out", "OUTPUT", "0", null)),
            List.of(
                edge("input", "decision", "next"),
                edge("decision", "transform", "case:yes"),
                edge("decision", "out", "default"),
                edge("transform", "decision", "next")));

    var problems = validator.diagnostics(definition, resolver);
    assertThat(
            problems.stream()
                .filter(problem -> problem.message().contains("Incomplete expression")))
        .flatExtracting(Validator.Problem::locations)
        .extracting(ArcException.Location::nodeId)
        .containsExactly("decision", "transform");
    assertThat(problems).anyMatch(problem -> problem.message().contains("cycles"));
  }

  /**
   * The rules a stored definition names, for deletion checks: unlike dependencies, an unpinned
   * Reference and the source mappings of a draft without an Input node count too.
   */
  @Test
  void calledRuleIdsCoverUnfinishedDrafts() {
    var sourced =
        new Input(
            "amount",
            "NUMBER",
            true,
            null,
            new SourceBinding("rates", 1, Map.of("key", "$TO_STRING(@lookup:2(1))"), "/x", "FAIL"));
    Node unpinned = nodeOf("tax", "REFERENCE", "Tax").rule("tax-rule", null).output("tax").build();
    Node pinned = nodeOf("fee", "REFERENCE", "Fee").rule("fee-rule", 3).output("fee").build();
    Node calling = node("calc", "FORMULA", "@pricing:1(amount)", "x");
    // A malformed expression calls nothing: the draft is unfinished, not a caller of "broken".
    Node malformed = node("draft", "FORMULA", "@broken:1(", "y");
    var withoutInput =
        new Definition(1, List.of(sourced), List.of(unpinned, calling, malformed), List.of());
    assertThat(Validator.calledRuleIds(withoutInput))
        .containsExactly("tax-rule", "lookup", "pricing");
    var withInput =
        new Definition(
            1,
            List.of(sourced),
            List.of(node("input", "INPUT", null, null), pinned, unpinned, calling, malformed),
            List.of());
    assertThat(Validator.calledRuleIds(withInput))
        .containsExactly("fee-rule", "tax-rule", "lookup", "pricing");
    var wellFormed =
        new Definition(
            1,
            List.of(sourced),
            List.of(node("input", "INPUT", null, null), pinned, unpinned, calling),
            List.of());
    assertThat(Validator.dependencies(wellFormed))
        .as("dependencies keep only complete pins, for validation")
        .extracting(Validator.Dependency::ruleId)
        .containsExactly("fee-rule", "lookup", "pricing");
  }
}
