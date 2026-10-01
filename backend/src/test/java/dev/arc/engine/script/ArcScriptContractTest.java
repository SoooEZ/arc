package dev.arc.engine.script;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import dev.arc.model.NodeKind;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ArcScriptContractTest {
  private final ArcScript script = new ArcScript(new ObjectMapper(), new Validator());

  @Test
  void canonicalTextPreservesCommentsEscapedLiteralsPinsAndConnectionIdentity() {
    String source =
        """
        // quote and delimiter round trip
        inputs { note: STRING optional default "a;{b}\\\"c"; }
        node start INPUT "Start" at (10, -20) { next -> child edge "custom-edge"; }
        node child REFERENCE "A \\\"quoted\\\" rule" {
          use "shared-rule" version 3;
          bind z = note;
          bind a = $CONCAT("{", note, ";}");
          as result;
          next -> done edge "child-result";
        }
        node done OUTPUT "Done" { return result; }
        """;
    var definition = script.parse(source);
    String canonical =
        """
        schema 1;

        // quote and delimiter round trip
        inputs {
          note: STRING optional default "a;{b}\\\"c";
        }

        node "start" INPUT "Start" at (10.0, -20.0) {
          next -> "child" edge "custom-edge";
        }

        node "child" REFERENCE "A \\\"quoted\\\" rule" at (300.0, 0.0) {
          use "shared-rule" version 3;
          bind a = $CONCAT("{", note, ";}");
          bind z = note;
          as result;
          next -> "done" edge "child-result";
        }

        node "done" OUTPUT "Done" at (600.0, 0.0) {
          return result;
        }
        """;
    assertThat(script.render(definition)).isEqualTo(canonical);
    assertThat(script.build(canonical).definition()).isEqualTo(definition);
    assertThat(script.renderNode(definition, "child"))
        .doesNotContain("inputs {", "// quote", "node \"start\"")
        .contains("version 3", "edge \"child-result\"");
  }

  @Test
  void everyNodeKindRendersItsCanonicalStatementsAndConnections() {
    String source =
        """
        // kinds
        inputs {
          amount: NUMBER required default 100;
          rate: NUMBER optional default 0.1;
          source rate = {"id":"country-tax","version":2,"bindings":{"key":"amount"},"pointer":"/rate","onError":"DEFAULT"};
        }
        node input INPUT "Inputs" at (0, 0) { next -> calc; }
        node calc FORMULA "Calc" at (0, 100) { let discount = amount * rate; next -> check; }
        node check CONDITION "Check" at (0, 200) { when discount > 5; true -> route; false -> pick; }
        node route SWITCH "Route" at (0, 300) {
          case big "Big" equals 100;
          select amount;
          CASE:big -> shape;
          default -> whole;
        }
        node pick SWITCH "Pick" at (300, 300) { case yes "Yes" when amount > 1; case:yes -> whole; DEFAULT -> reuse; }
        node shape TRANSFORM "Shape" at (0, 400) { field "value" = amount; as data; next -> reuse; }
        node whole TRANSFORM "Whole" at (300, 400) { let items = [amount]; next -> reuse; }
        node reuse REFERENCE "Reuse" at (0, 500) {
          use "apply-discount" version 1;
          bind rate = 0.2;
          bind amount = amount;
          as price;
          next -> done;
        }
        node done OUTPUT "Done" at (0, 600) { return price; as total; }
        """;
    String canonical =
        """
        schema 1;

        // kinds
        inputs {
          amount: NUMBER required default 100;
          rate: NUMBER optional default 0.1;
          source rate = {"id":"country-tax","version":2,"bindings":{"key":"amount"},"pointer":"/rate","onError":"DEFAULT"};
        }

        node "input" INPUT "Inputs" at (0.0, 0.0) {
          next -> "calc" edge "input-next-calc";
        }

        node "calc" FORMULA "Calc" at (0.0, 100.0) {
          let discount = amount * rate;
          next -> "check" edge "calc-next-check";
        }

        node "check" CONDITION "Check" at (0.0, 200.0) {
          when discount > 5;
          true -> "route" edge "check-true-route";
          false -> "pick" edge "check-false-pick";
        }

        node "route" SWITCH "Route" at (0.0, 300.0) {
          select amount;
          case "big" "Big" equals 100;
          case:big -> "shape" edge "route-case:big-shape";
          default -> "whole" edge "route-default-whole";
        }

        node "pick" SWITCH "Pick" at (300.0, 300.0) {
          case "yes" "Yes" when amount > 1;
          case:yes -> "whole" edge "pick-case:yes-whole";
          default -> "reuse" edge "pick-default-reuse";
        }

        node "shape" TRANSFORM "Shape" at (0.0, 400.0) {
          field "value" = amount;
          as data;
          next -> "reuse" edge "shape-next-reuse";
        }

        node "whole" TRANSFORM "Whole" at (300.0, 400.0) {
          let items = [amount];
          next -> "reuse" edge "whole-next-reuse";
        }

        node "reuse" REFERENCE "Reuse" at (0.0, 500.0) {
          use "apply-discount" version 1;
          bind amount = amount;
          bind rate = 0.2;
          as price;
          next -> "done" edge "reuse-next-done";
        }

        node "done" OUTPUT "Done" at (0.0, 600.0) {
          return price;
          as total;
        }
        """;
    var built = script.build(source);
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.source()).isEqualTo(canonical);
    assertThat(script.render(built.definition())).isEqualTo(canonical);
    assertThat(script.build(canonical).definition()).isEqualTo(built.definition());
    assertThat(script.renderNode(built.definition(), "input"))
        .isEqualTo(
            canonical.substring(0, canonical.indexOf("\nnode \"calc\"")).replace("// kinds\n", ""));
    assertThat(script.renderNode(built.definition(), "done"))
        .isEqualTo("schema 1;\n\n" + canonical.substring(canonical.indexOf("\nnode \"done\"")));
  }

  /**
   * Every kind's declarations round-trip, and the parser's keyword table is exhaustive over the
   * kinds, as this helper is: a new kind fails to compile here until it decides its statements.
   */
  @Test
  void everyNodeKindRoundTripsItsDeclarationsAndAsNamesTheRightProperty() {
    for (NodeKind kind : NodeKind.values()) {
      for (Node node : representatives(kind)) {
        var graph = new Definition(1, List.of(), List.of(node), List.of());
        var built = script.build(script.render(graph));
        assertThat(built.diagnostics()).as(kind.name()).isEmpty();
        assertThat(built.definition().nodes()).as(kind.name()).containsExactly(node);
        assertThat(node.outputName() != null)
            .as(kind + " as names the Output field")
            .isEqualTo(kind == NodeKind.OUTPUT);
        assertThat(node.output() != null)
            .as(kind + " names a result variable")
            .isEqualTo(kind.storesResult());
      }
    }
    var unsupported = script.build("node n FORMULA \"N\" {\n  let total = 1;\n  as alias;\n}");
    assertThat(unsupported.definition()).isNull();
    assertThat(unsupported.diagnostics())
        .containsExactly(
            new ArcScript.Diagnostic("Unsupported statement for FORMULA: as alias", 3, 3));
  }

  /** A complete node of the kind, with every statement the kind declares (Transform twice). */
  private static List<Node> representatives(NodeKind kind) {
    var node = nodeOf("n", kind.name(), "N").at(0, 0);
    return switch (kind) {
      case INPUT -> List.of(node.build());
      case FORMULA -> List.of(node.expression("amount * 2").output("total").build());
      case CONDITION -> List.of(node.expression("amount > 1").build());
      case SWITCH ->
          List.of(
              node.selector("amount")
                  .cases(List.of(new Definition.BranchCase("big", "Big", "100")))
                  .build());
      case TRANSFORM ->
          List.of(
              nodeOf("n", kind.name(), "N")
                  .at(0, 0)
                  .fields(List.of(new Definition.Field("value", "amount")))
                  .output("data")
                  .build(),
              node.expression("[amount]").output("items").build());
      case REFERENCE ->
          List.of(
              node.rule("apply-discount", 1)
                  .bindings(Map.of("rate", "0.2"))
                  .output("price")
                  .build());
      case OUTPUT -> List.of(node.expression("price").outputName("total").build());
    };
  }

  @Test
  void inputDeclarationsUseTheDeclaredTypeNamesInAnyCase() {
    var built = script.build("inputs { items: array optional; }\nnode in INPUT \"In\" {}");
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.definition().inputs().getFirst().type()).isEqualTo("ARRAY");
    assertThat(script.build("inputs { amount: DECIMAL required; }").diagnostics())
        .containsExactly(
            new ArcScript.Diagnostic(
                "Use: parameter: NUMBER|STRING|BOOLEAN|ARRAY|OBJECT required|optional [default"
                    + " JSON];",
                1,
                10));
    var undeclared =
        new Definition(
            1,
            List.of(new Definition.Input("amount", "DECIMAL", true, null)),
            List.of(nodeOf("in", "INPUT", "In").build()),
            List.of());
    assertThatThrownBy(() -> new Validator().shape(undeclared)).hasMessage("Unknown input type");
  }

  /**
   * A '//' comment is a note wherever it starts outside quotes, as the code editor shows it. Inside
   * a statement or a node header it failed the build ("Invalid expression"), because only a comment
   * between statements was read as one.
   */
  @Test
  void aCommentInsideAStatementOrHeaderIsANoteLikeOneBetweenStatements() {
    var built =
        script.build(
            """
            inputs {
              amount: NUMBER required; // the order total
              rate: NUMBER optional default 0.1;
            }
            node input INPUT "Input" { next -> total; }
            node total FORMULA "Total" // after tax
              at (300, 0) {
              let total = amount // before tax
                // a line of its own
                * (1 + rate);
              next -> done;
            }
            node done OUTPUT "Done" { return $CONCAT("a // b", total); }
            """);
    assertThat(built.diagnostics()).isEmpty();
    var definition = built.definition();
    assertThat(definition.notes())
        .containsExactly("the order total", "after tax", "before tax", "a line of its own");
    Node total = definition.nodes().get(1);
    assertThat(total.expression()).isEqualTo("amount\n    * (1 + rate)");
    assertThat(total.position()).isEqualTo(new Definition.Position(300, 0));
    assertThat(definition.nodes().get(2).expression()).isEqualTo("$CONCAT(\"a // b\", total)");
    assertThat(script.build(built.source()).definition()).isEqualTo(definition);
  }

  /**
   * A source binding is JSON read strictly whatever the application's settings: under Spring's
   * mapper "pointr" for "pointer" was dropped, so the input read the source's whole response and
   * fell back to its default on every run, and a version of 1.9 pinned version 1.
   */
  @Test
  void aSourceBindingWithAnUnknownFieldOrAFractionalVersionIsRefused() {
    var lenientApplicationJson =
        new ArcScript(
            JsonMapper.builder().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build(),
            new Validator());
    String valid =
        "{\"id\":\"rates\",\"version\":1,\"bindings\":{},\"pointer\":\"/rate\",\"onError\":\"DEFAULT\"}";
    assertThat(lenientApplicationJson.build(sourcedRate(valid)).diagnostics()).isEmpty();
    for (String binding :
        List.of(
            valid.replace("pointer", "pointr"),
            valid.replace("\"version\":1", "\"version\":1.9"))) {
      var build = lenientApplicationJson.build(sourcedRate(binding));
      assertThat(build.definition()).isNull();
      assertThat(build.diagnostics())
          .extracting(ArcScript.Diagnostic::message, ArcScript.Diagnostic::line)
          .containsExactly(tuple("Invalid JSON literal or source binding", 3));
    }
  }

  /**
   * A source binding's mappings are expressions, checked at build like a node's: an unparsable
   * mapping built, and only the graph's diagnostics reported it, away from its statement.
   */
  @Test
  void anUnparsableSourceMappingFailsTheBuildAtItsStatement() {
    var build =
        script.build(
            sourcedRate(
                "{\"id\":\"rates\",\"version\":1,\"bindings\":{\"key\":\"rate +\"},"
                    + "\"pointer\":\"/rate\",\"onError\":\"DEFAULT\"}"));
    assertThat(build.definition()).isNull();
    assertThat(build.diagnostics())
        .extracting(ArcScript.Diagnostic::message, ArcScript.Diagnostic::line)
        .containsExactly(tuple("rate source / key: Incomplete expression", 3));
  }

  private static String sourcedRate(String binding) {
    return "inputs {\n  rate: NUMBER optional default 0.1;\n  source rate = "
        + binding
        + ";\n}\nnode input INPUT \"Input\" { next -> done; }\nnode done OUTPUT \"Done\" { return rate; }\n";
  }

  @Test
  void scannerFailureRetainsItsExactLocationAndDoesNotLeakIntoTheNextBuild() {
    String incomplete =
        """
        // discarded build
        inputs {}
        node out OUTPUT "Result" {
          return "unfinished;
        }
        """;
    var failed = script.build(incomplete);
    assertThat(failed.definition()).isNull();
    assertThat(failed.source()).isEqualTo(incomplete);
    assertThat(failed.diagnostics())
        .containsExactly(new ArcScript.Diagnostic("Unfinished statement or quoted string", 4, 3));

    var next = script.build("node out OUTPUT \"Result\" { return 1; }");
    assertThat(next.diagnostics()).isEmpty();
    assertThat(next.definition().notes()).isEmpty();
    assertThat(next.source()).doesNotContain("discarded build");
  }

  @Test
  void prefixedFunctionsRoundTripWithoutRewritingQuotedDollars() {
    String source =
        """
        inputs { ROUND: NUMBER required; }
        node start INPUT "Start" { next -> calc; }
        node calc FORMULA "Calculate" {
          let value = $ROUND(ROUND, 2) + $ROUND(1, 0);
          next -> done;
        }
        node done OUTPUT "Done" {
          return $OBJECT("$ROUND(1) and ROUND(1)", $IF(value > 0, value, 0));
        }
        """;
    var built = script.build(source);
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.source())
        .contains("$ROUND(ROUND, 2) + $ROUND(1, 0)", "\"$ROUND(1) and ROUND(1)\"");
    assertThat(script.build(built.source()).definition()).isEqualTo(built.definition());
    assertThat(
            script
                .buildNode(
                    built.definition(), "calc", script.renderNode(built.definition(), "calc"))
                .definition())
        .isEqualTo(built.definition());
    assertThat(Expressions.compile(built.definition().nodes().get(1).expression()).variables())
        .containsExactly("ROUND");
    new Validator()
        .validate(
            built.definition(),
            (id, version) -> {
              throw new AssertionError("Unexpected reference");
            });
    var legacy = script.build(source.replace("$ROUND(ROUND, 2)", "ROUND(ROUND, 2)"));
    assertThat(legacy.definition()).isNull();
    assertThat(legacy.diagnostics())
        .extracting(ArcScript.Diagnostic::message)
        .containsExactly("Function calls require a $ prefix; use $ROUND(...)");
  }

  @Test
  void largeValidGraphsRemainEditableThroughTheirRenderedCode() throws Exception {
    var nodes = new ArrayList<Node>();
    var edges = new ArrayList<Edge>();
    nodes.add(nodeOf("input", "INPUT", "Input").at(0, 0).build());
    String previous = "input";
    for (int index = 0; index < 60; index++) {
      String id = "formula" + index;
      nodes.add(
          nodeOf(id, "FORMULA", "Formula " + index)
              .at(0, (index + 1) * 100)
              .expression("\"" + "x".repeat(1900) + "\"")
              .output("value" + index)
              .build());
      edges.add(new Edge(previous + "-" + id, previous, id, "next"));
      previous = id;
    }
    nodes.add(nodeOf("output", "OUTPUT", "Output").at(0, 6100).expression("value59").build());
    edges.add(new Edge(previous + "-output", previous, "output", "next"));
    Definition graph = new Definition(1, List.of(), nodes, edges);
    RuleResolver noReferences =
        (id, version) -> {
          throw new AssertionError("Unexpected reference");
        };
    new Validator().validate(graph, noReferences);

    String source = script.render(graph);
    assertThat(source.length()).isGreaterThan(100_000);
    var json = new ObjectMapper();
    assertThat(json.writeValueAsBytes(graph).length).isLessThan(1_048_576);
    assertThat(json.writeValueAsBytes(Map.of("source", source)).length).isLessThan(1_048_576);
    var rebuilt = script.build(source);
    assertThat(rebuilt.diagnostics()).isEmpty();
    assertThat(rebuilt.definition()).isEqualTo(graph);
  }

  @Test
  void oversizedSourceStillReturnsDiagnosticsWithoutAResult() {
    var built = script.build(" ".repeat(1_048_577));
    assertThat(built.definition()).isNull();
    assertThat(built.diagnostics())
        .containsExactly(
            new ArcScript.Diagnostic("Source must be at most 1,048,576 characters", 1, 1));
  }
}
