package dev.arc.engine.script;

import static dev.arc.support.GraphFixtures.copyOf;
import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

/**
 * ARC Script represents unfinished drafts without inventing code: building the rendered text gives
 * the same draft back, so validation reaches the same verdict before and after a code round trip.
 */
class DraftRoundTripTest {
  private static final Position AT = new Position(300, 0);
  private static final List<String> NAMES = Arrays.asList(null, "", "total");
  private static final List<String> EXPRESSIONS = Arrays.asList(null, "", "amount * 2");

  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Definition child =
      new Definition(
          1,
          List.of(new Input("amount", "NUMBER", true, null)),
          List.of(inputNode("in", "In"), outputNode("out", "Out", "amount")),
          List.of(new Edge("next", "in", "out", "next")));
  private final RuleResolver resolver =
      (id, version) -> {
        if (id.equals("child") && version == 2) return child;
        throw new ArcException(404, "Published rule version not found: " + id + " v" + version);
      };

  @Test
  void everyUnfinishedNodeRoundTripsThroughGraphAndNodeCode() {
    var drafts = unfinishedNodes();
    assertThat(drafts).hasSizeGreaterThan(80);
    for (Node node : drafts) {
      Definition draft = graph(node);
      validator.shape(draft);
      String text = script.render(draft);
      Definition expected = canonical(draft);

      var built = script.build(text);
      assertThat(built.diagnostics()).as(text).isEmpty();
      assertThat(built.definition()).as(text).isEqualTo(expected);
      assertThat(built.source()).as(text).isEqualTo(text);

      String fragment = script.renderNode(draft, "n");
      var applied = script.buildNode(draft, "n", fragment);
      assertThat(applied.diagnostics()).as(fragment).isEmpty();
      assertThat(applied.definition()).as(fragment).isEqualTo(expected);

      assertThat(validator.diagnostics(built.definition(), resolver))
          .as(text)
          .isEqualTo(validator.diagnostics(draft, resolver));
    }
  }

  @Test
  void aConditionWrittenWithoutWhenStaysInvalidAfterEveryBuild() {
    String source =
        """
        inputs { amount: NUMBER required; }
        node "in" INPUT "Inputs" at (0, 0) { next -> "check"; }
        node "check" CONDITION "Big order?" at (0, 100) {
          true -> "yes";
          false -> "no";
        }
        node "yes" OUTPUT "Yes" at (0, 200) { return "approve"; }
        node "no" OUTPUT "No" at (200, 200) { return "reject"; }
        """;
    var first = script.build(source);
    assertThat(first.diagnostics()).isEmpty();
    assertThat(first.source()).doesNotContain("when");
    assertRejectedWithoutExpression(first.definition());

    var second = script.build(first.source().replace("\"Yes\"", "\"Approve\""));
    assertThat(second.definition().nodes().get(1).expression()).isNull();
    assertRejectedWithoutExpression(second.definition());

    var applied =
        script.buildNode(
            second.definition(), "check", script.renderNode(second.definition(), "check"));
    assertThat(applied.definition()).isEqualTo(second.definition());
    assertRejectedWithoutExpression(applied.definition());
  }

  @Test
  void emptyNamesAndSelectorsNoLongerRenderUnparseableStatements() {
    var formula = formula("", "amount * 2");
    var transform = transform("", fieldList("1"), null);
    var reference = reference("", "child", 2, Map.of("amount", "1"));
    var value = switchNode("", caseList("\"a\""));
    assertThat(script.render(graph(formula))).contains("  let = amount * 2;\n");
    assertThat(script.render(graph(transform)))
        .contains("  field \"value\" = 1;\n")
        .doesNotContain("  as ");
    assertThat(script.render(graph(reference)))
        .contains("  use \"child\" version 2;\n  bind amount = 1;\n  next")
        .doesNotContain(" as ");
    assertThat(script.render(graph(value)))
        .contains("  select;\n  case \"big\" \"Big\" equals \"a\";");
    for (Node node : List.of(formula, transform, reference, value))
      assertThat(script.build(script.render(graph(node))).definition())
          .isEqualTo(canonical(graph(node)));
  }

  @Test
  void unfinishedStatementsParseAsWritten() {
    var built =
        script.build(
            """
            node f FORMULA "Formula" { let total; }
            node g FORMULA "Unnamed" { let = 1; }
            node c CONDITION "Check" { when; }
            node s SWITCH "Choose" { select; case a "A" equals; }
            node t TRANSFORM "Shape" { field "x" =; }
            node r REFERENCE "Reuse" { use "child"; bind amount =; }
            node o OUTPUT "Result" { return; }
            """);
    assertThat(built.diagnostics()).isEmpty();
    var nodes = built.definition().nodes();
    assertThat(nodes.get(0).output()).isEqualTo("total");
    assertThat(nodes.get(0).expression()).isNull();
    assertThat(nodes.get(1).output()).isNull();
    assertThat(nodes.get(1).expression()).isEqualTo("1");
    assertThat(nodes.get(2).expression()).isEmpty();
    assertThat(nodes.get(3).selector()).isEmpty();
    assertThat(nodes.get(3).cases()).containsExactly(new BranchCase("a", "A", ""));
    assertThat(nodes.get(4).fields()).containsExactly(new Field("x", ""));
    assertThat(nodes.get(5).ruleId()).isEqualTo("child");
    assertThat(nodes.get(5).version()).isNull();
    assertThat(nodes.get(5).bindings()).isEqualTo(Map.of("amount", ""));
    assertThat(nodes.get(6).expression()).isEmpty();
  }

  private void assertRejectedWithoutExpression(Definition definition) {
    assertThatThrownBy(() -> validator.validate(definition, resolver))
        .hasMessage("Big order?: Expression is required");
  }

  /** The owned values of every node kind, each unset, empty or set. */
  private static List<Node> unfinishedNodes() {
    var nodes = new ArrayList<Node>();
    for (String output : NAMES)
      for (String expression : EXPRESSIONS) nodes.add(formula(output, expression));
    for (String expression : EXPRESSIONS) nodes.add(condition(expression));
    for (String expression : EXPRESSIONS)
      for (String outputName : NAMES) nodes.add(output(expression, outputName));
    for (String selector : Arrays.asList(null, "", "amount"))
      for (List<BranchCase> cases :
          Arrays.asList(null, List.<BranchCase>of(), caseList(""), caseList("amount > 1")))
        nodes.add(switchNode(selector, cases));
    for (String output : NAMES) {
      for (List<Field> fields : Arrays.asList(null, List.<Field>of()))
        for (String expression : EXPRESSIONS) nodes.add(transform(output, fields, expression));
      for (String value : List.of("", "amount"))
        nodes.add(transform(output, fieldList(value), null));
    }
    for (String output : NAMES)
      for (Map<String, String> bindings :
          Arrays.asList(
              null, Map.<String, String>of(), Map.of("amount", ""), Map.of("amount", "1")))
        for (Integer version : Arrays.asList(null, 2)) {
          nodes.add(reference(output, "child", version, bindings));
          if (version == null) nodes.add(reference(output, null, null, bindings));
        }
    return nodes;
  }

  private static Node formula(String output, String expression) {
    return nodeOf("n", "FORMULA", "N").position(AT).expression(expression).output(output).build();
  }

  private static Node condition(String expression) {
    return nodeOf("n", "CONDITION", "N").position(AT).expression(expression).build();
  }

  private static Node output(String expression, String outputName) {
    return nodeOf("n", "OUTPUT", "N")
        .position(AT)
        .expression(expression)
        .outputName(outputName)
        .build();
  }

  private static Node switchNode(String selector, List<BranchCase> cases) {
    return nodeOf("n", "SWITCH", "N").position(AT).cases(cases).selector(selector).build();
  }

  private static Node transform(String output, List<Field> fields, String expression) {
    return nodeOf("n", "TRANSFORM", "N")
        .position(AT)
        .expression(expression)
        .output(output)
        .fields(fields)
        .build();
  }

  private static Node reference(
      String output, String ruleId, Integer version, Map<String, String> bindings) {
    return nodeOf("n", "REFERENCE", "N")
        .position(AT)
        .output(output)
        .rule(ruleId, version)
        .bindings(bindings)
        .build();
  }

  private static List<BranchCase> caseList(String expression) {
    return List.of(new BranchCase("big", "Big", expression));
  }

  private static List<Field> fieldList(String expression) {
    return List.of(new Field("value", expression));
  }

  /** Input, the node under test, and an Output that every exit of that node leads to. */
  private static Definition graph(Node node) {
    var input = nodeOf("input", "INPUT", "Inputs").at(0, 0).build();
    var out = nodeOf("out", "OUTPUT", "Out").at(600, 0).expression("1").build();
    var edges = new ArrayList<Edge>(List.of(new Edge("enter", "input", "n", "next")));
    for (String handle : exits(node)) edges.add(new Edge("leave-" + handle, "n", "out", handle));
    var nodes = node.type().equals("OUTPUT") ? List.of(input, node) : List.of(input, node, out);
    return new Definition(1, List.of(new Input("amount", "NUMBER", true, null)), nodes, edges);
  }

  private static List<String> exits(Node node) {
    return switch (node.type()) {
      case "OUTPUT" -> List.of();
      case "CONDITION" -> List.of("true", "false");
      case "SWITCH" -> {
        var handles = new ArrayList<String>();
        if (node.cases() != null)
          for (BranchCase option : node.cases()) handles.add("case:" + option.id());
        handles.add("default");
        yield handles;
      }
      default -> List.of("next");
    };
  }

  /**
   * The draft as ARC Script reads it back: empty and missing names are both unset, and each node
   * kind's collection has one form for "none" (Reference bindings {}, Switch cases [], no fields).
   */
  private static Definition canonical(Definition draft) {
    var nodes = new ArrayList<Node>();
    for (Node node : draft.nodes())
      nodes.add(
          copyOf(node)
              .output(unset(node.output()))
              .bindings(
                  node.type().equals("REFERENCE") && node.bindings() == null
                      ? Map.of()
                      : node.bindings())
              .cases(
                  node.type().equals("SWITCH") && node.cases() == null ? List.of() : node.cases())
              .fields(node.fields() == null || node.fields().isEmpty() ? null : node.fields())
              .outputName(unset(node.outputName()))
              .build());
    return new Definition(1, draft.inputs(), nodes, draft.edges(), List.of());
  }

  private static String unset(String name) {
    return name == null || name.isEmpty() ? null : name;
  }
}
