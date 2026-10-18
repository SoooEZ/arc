package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.Limits;
import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class ValidatorTest {
  private final Validator validator = new Validator();
  private final RuleResolver resolver =
      (id, version) -> {
        throw new ArcException(404, "Published version not found");
      };

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
    var base = calculation();
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
        .hasMessageContaining(
            "uses x, which is not set on every path into this step; set it on each path that"
                + " leads here");
  }

  /**
   * Validation, diagnostics and publishing accepted two unconditional, unrelated writers of one
   * result variable, and every execution of the published version then failed with "Conflicting
   * upstream values". The graph alone decides this shape, so it is reported at the join, naming the
   * variable and both writers, with the join's location first.
   */
  @Test
  void independentWritersOfOneVariableFailValidationAtTheJoin() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                nodeOf("a", "FORMULA", "List price").expression("1").output("price").build(),
                nodeOf("b", "FORMULA", "Member price").expression("2").output("price").build(),
                nodeOf("out", "OUTPUT", "Return").expression("price").build()),
            List.of(
                edge("input", "a", "next"),
                edge("input", "b", "next"),
                edge("a", "out", "next"),
                edge("b", "out", "next")));
    String message =
        "Conflicting upstream values for 'price': List price and Member price both set it on"
            + " every path to Return; use distinct result variable names before merging";
    assertThatThrownBy(() -> validator.validate(d, resolver))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage()).isEqualTo(message);
              assertThat(error.locations())
                  .containsExactly(
                      new ArcException.Location(null, null, "out", "Return"),
                      new ArcException.Location(null, null, "a", "List price"),
                      new ArcException.Location(null, null, "b", "Member price"));
            });
    assertThat(validator.diagnose(d, resolver).problems())
        .containsExactly(
            new Validator.Problem(
                message,
                List.of(
                    new ArcException.Location(null, null, "out", "Return"),
                    new ArcException.Location(null, null, "a", "List price"),
                    new ArcException.Location(null, null, "b", "Member price"))));
    // Distinct names, as the message asks, make the same graph valid.
    var renamed = new ArrayList<>(d.nodes());
    renamed.set(2, copyOf(d.nodes().get(2)).output("memberPrice").build());
    assertThatCode(
            () -> validator.validate(new Definition(1, d.inputs(), renamed, d.edges()), resolver))
        .doesNotThrowAnyException();
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
    var base = calculation();
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
  void inputAndDocumentProblemsAppearOnTheInputNodeWhereverTheShapeIsChecked() {
    // Save, render and /variables returned them unlocated, unlike /validate and /diagnostics.
    var base = calculation();
    var input = base.inputNode().orElseThrow();
    var amount = new Input("amount", "NUMBER", true, null);
    var duplicated = new Definition(1, List.of(amount, amount), base.nodes(), base.edges());
    var emptySourceId =
        new Definition(
            1,
            List.of(
                new Input(
                    "rate", "NUMBER", false, null, new SourceBinding("", 1, Map.of(), "", "FAIL"))),
            base.nodes(),
            base.edges());
    var tooMany = new ArrayList<Input>();
    for (int index = 0; index <= Limits.MAX_INPUTS; index++)
      tooMany.add(new Input("input" + index, "NUMBER", true, null));
    var overLimit = new Definition(1, tooMany, base.nodes(), base.edges());
    for (var problem :
        Map.of(
                duplicated, "Duplicate input: amount",
                emptySourceId, "Source needs an ID and version",
                overLimit, "Provide at most " + Limits.MAX_INPUTS + " inputs")
            .entrySet())
      assertThatThrownBy(() -> validator.shape(problem.getKey()))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo(problem.getValue());
                assertThat(error.locations())
                    .containsExactly(
                        new ArcException.Location(null, null, input.id(), input.label()));
              });
    // A draft without an Input node keeps the problem unlocated.
    var noInput =
        new Definition(
            1, List.of(amount, amount), List.of(outputNode("out", "Out", "1")), List.of());
    assertThatThrownBy(() -> validator.shape(noInput))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.locations()).isEmpty());
  }

  @Test
  void inputNamesRejectWhitespaceAndFunctionPrefixesWithoutReservingFunctionNames() {
    var base = calculation();
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
        assertThat(validator.diagnose(definition, resolver).problems())
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
            calculation().nodes(),
            calculation().edges());
    assertThatThrownBy(() -> validator.validate(d, (id, v) -> child))
        .hasMessage("reuse: choose what to pass as amount to missing v1");

    // A binding must name an input of the pinned version; removing this check failed no test.
    var bindings = new LinkedHashMap<String, String>();
    bindings.put("amount", "1");
    bindings.put("ghost", "2");
    var extra =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                nodeOf("reuse", "REFERENCE", "reuse")
                    .at(0, 0)
                    .output("value")
                    .rule("child", 1)
                    .bindings(bindings)
                    .build(),
                node("out", "OUTPUT", "value", null)),
            List.of(edge("input", "reuse", "next"), edge("reuse", "out", "next")));
    assertThatThrownBy(() -> validator.validate(extra, (id, v) -> child))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage())
                  .isEqualTo(
                      "reuse: child v1 has no input named ghost; remove what this step passes as ghost");
              assertThat(error.locations())
                  .containsExactly(new ArcException.Location(null, null, "reuse", "reuse"));
            });
    assertThat(validator.diagnose(extra, (id, v) -> child).problems())
        .extracting(Validator.Problem::message)
        .containsExactly(
            "reuse: child v1 has no input named ghost; remove what this step passes as ghost");
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

    var problems = validator.diagnose(definition, resolver).problems();
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

  /**
   * The versions of one rule that a stored definition pins, for the callers list: every Reference
   * version and well-formed call of that rule, in any node expression or source mapping, sorted and
   * once each. A Reference that names the rule without a version, a malformed call, a call inside a
   * string literal and the pins of other rules add none.
   */
  @Test
  void pinnedVersionsListEveryVersionOfOneRuleThatADefinitionPins() {
    var sourced =
        new Input(
            "amount",
            "NUMBER",
            true,
            null,
            new SourceBinding(
                "rates", 1, Map.of("key", "$TO_STRING(@pricing:4(1))"), "/x", "FAIL"));
    Node pinned = nodeOf("fee", "REFERENCE", "Fee").rule("pricing", 3).output("fee").build();
    Node again = nodeOf("fee2", "REFERENCE", "Fee 2").rule("pricing", 3).output("fee2").build();
    Node unpinned = nodeOf("tax", "REFERENCE", "Tax").rule("pricing", null).output("tax").build();
    Node other = nodeOf("other", "REFERENCE", "Other").rule("other-rule", 9).output("o").build();
    Node calling = node("calc", "FORMULA", "@pricing:1(amount) + @other-rule:7(amount)", "x");
    Node quoted = node("text", "FORMULA", "\"@pricing:8(1)\"", "t");
    Node malformed = node("draft", "FORMULA", "@pricing:6(", "y");
    var definition =
        new Definition(
            1,
            List.of(sourced),
            List.of(pinned, again, unpinned, other, calling, quoted, malformed),
            List.of());

    assertThat(Validator.pinnedVersions(definition, "pricing")).containsExactly(1, 3, 4);
    assertThat(Validator.pinnedVersions(definition, "other-rule")).containsExactly(7, 9);
    assertThat(Validator.pinnedVersions(definition, "missing")).isEmpty();
    var onlyUnpinned = new Definition(1, List.of(), List.of(unpinned), List.of());
    assertThat(Validator.calledRuleIds(onlyUnpinned)).containsExactly("pricing");
    assertThat(Validator.pinnedVersions(onlyUnpinned, "pricing")).isEmpty();
    assertThat(Validator.pinnedVersions(new Definition(1, null, null, null), "pricing")).isEmpty();
  }

  /**
   * A stored row of another model shape, which draft shape would refuse today, is read as it is: an
   * unknown node type threw, and a missing list or a source without mappings was a 500 in the
   * deletion check and in a publish's callee hold.
   */
  @Test
  void calledRuleIdsReadStoredRowsOfAnotherShapeAsTheyAre() {
    assertThat(Validator.calledRuleIds(new Definition(1, null, null, null))).isEmpty();
    Node laterKind =
        nodeOf("later", "LOOP", "Later").rule("future-kind", 1).expression("@called:1()").build();
    var unmapped =
        new Input(
            "amount", "NUMBER", true, null, new SourceBinding("rates", 1, null, "/r", "FAIL"));
    var row = new Definition(1, List.of(unmapped), Arrays.asList(null, laterKind), null);
    assertThat(Validator.calledRuleIds(row)).containsExactly("future-kind", "called");
  }

  /**
   * The 500-character limit shared the leading-slash message, so a long pointer was told to start
   * with /.
   */
  @Test
  void anOverLongPointerIsRefusedByItsOwnMessage() {
    Function<String, Definition> withPointer =
        pointer ->
            new Definition(
                1,
                List.of(
                    new Input(
                        "rate",
                        "NUMBER",
                        true,
                        null,
                        new SourceBinding("rates", 1, Map.of(), pointer, "FAIL"))),
                List.of(node("input", "INPUT", null, null)),
                List.of());
    validator.shape(withPointer.apply("/" + "r".repeat(Limits.MAX_POINTER_CHARACTERS - 1)));
    assertThatThrownBy(
            () ->
                validator.shape(withPointer.apply("/" + "r".repeat(Limits.MAX_POINTER_CHARACTERS))))
        .hasMessage("JSON pointer exceeds 500 characters");
    assertThatThrownBy(() -> validator.shape(withPointer.apply("rate")))
        .hasMessage("Use a JSON pointer starting with /");
  }
}
