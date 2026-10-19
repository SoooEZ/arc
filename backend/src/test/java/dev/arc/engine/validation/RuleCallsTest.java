package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.NodeKind;
import dev.arc.support.GraphFixtures.NodeBuilder;
import java.util.*;
import org.junit.jupiter.api.Test;

/** The rules a definition calls: strict dependencies and the lenient callee-set reading. */
class RuleCallsTest {
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
    assertThat(RuleCalls.calledRuleIds(withoutInput))
        .containsExactly("tax-rule", "lookup", "pricing");
    var withInput =
        new Definition(
            1,
            List.of(sourced),
            List.of(node("input", "INPUT", null, null), pinned, unpinned, calling, malformed),
            List.of());
    assertThat(RuleCalls.calledRuleIds(withInput))
        .containsExactly("fee-rule", "tax-rule", "lookup", "pricing");
    var wellFormed =
        new Definition(
            1,
            List.of(sourced),
            List.of(node("input", "INPUT", null, null), pinned, unpinned, calling),
            List.of());
    assertThat(RuleCalls.dependencies(wellFormed))
        .as("dependencies keep only complete pins, for validation")
        .extracting(RuleCalls.Dependency::ruleId)
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

    assertThat(RuleCalls.pinnedVersions(definition, "pricing")).containsExactly(1, 3, 4);
    assertThat(RuleCalls.pinnedVersions(definition, "other-rule")).containsExactly(7, 9);
    assertThat(RuleCalls.pinnedVersions(definition, "missing")).isEmpty();
    var onlyUnpinned = new Definition(1, List.of(), List.of(unpinned), List.of());
    assertThat(RuleCalls.calledRuleIds(onlyUnpinned)).containsExactly("pricing");
    assertThat(RuleCalls.pinnedVersions(onlyUnpinned, "pricing")).isEmpty();
    assertThat(RuleCalls.pinnedVersions(new Definition(1, null, null, null), "pricing")).isEmpty();
  }

  /**
   * The callee set reads {@link Node#expressionTexts}, while validation enumerates a kind's owned
   * expressions on its own: each list switches over its own enum. For every kind with every
   * property it uses set, the callee walk must read every expression validation owns, or a call
   * there could not keep its callee from deletion.
   */
  @Test
  void theCalleeWalkReadsEveryExpressionAKindOwns() {
    for (NodeKind kind : NodeKind.values()) {
      var builder = nodeOf("n", kind.name(), "N");
      for (NodeKind.Property property : NodeKind.Property.values())
        if (kind.uses(property)) withEvery(builder, property);
      Node node = builder.build();
      var owned =
          NodeValidation.expressions(node).stream()
              .map(NodeValidation.OwnedExpression::source)
              .toList();
      assertThat(node.expressionTexts()).as(kind.name()).containsAll(owned);
    }
  }

  /** Sets one property to a value that holds a call wherever it is an expression. */
  private static NodeBuilder withEvery(NodeBuilder builder, NodeKind.Property property) {
    return switch (property) {
      case EXPRESSION -> builder.expression("@expression:1()");
      case SELECTOR -> builder.selector("@selector:1()");
      case CASES -> builder.cases(List.of(new BranchCase("c", "C", "@case:1()")));
      case FIELDS -> builder.fields(List.of(new Field("f", "@field:1()")));
      case BINDINGS -> builder.bindings(Map.of("b", "@binding:1()"));
      case RULE -> builder.rule("called", 1);
      case OUTPUT -> builder.output("result");
      case OUTPUT_NAME -> builder.outputName("named");
      case TABLE ->
          builder.table(
              new DecisionTable(
                  null,
                  List.of(new DecisionTable.Condition("C", "@condition:1()")),
                  List.of(new DecisionTable.Result("r")),
                  List.of(new DecisionTable.Row(List.of("-"), List.of("@result:1()")))));
    };
  }

  /**
   * A stored row of another model shape, which draft shape would refuse today, is read as it is: an
   * unknown node type threw, and a missing list or a source without mappings was a 500 in the
   * deletion check and in a publish's callee hold.
   */
  @Test
  void calledRuleIdsReadStoredRowsOfAnotherShapeAsTheyAre() {
    assertThat(RuleCalls.calledRuleIds(new Definition(1, null, null, null))).isEmpty();
    Node laterKind =
        nodeOf("later", "LOOP", "Later").rule("future-kind", 1).expression("@called:1()").build();
    var unmapped =
        new Input(
            "amount", "NUMBER", true, null, new SourceBinding("rates", 1, null, "/r", "FAIL"));
    var row = new Definition(1, List.of(unmapped), Arrays.asList(null, laterKind), null);
    assertThat(RuleCalls.calledRuleIds(row)).containsExactly("future-kind", "called");
  }
}
