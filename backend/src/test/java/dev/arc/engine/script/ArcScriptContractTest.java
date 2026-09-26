package dev.arc.engine.script;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import dev.arc.model.Definition.Node;
import dev.arc.model.Definition.Position;
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
    assertThat(script.checkExpression(built.definition().nodes().get(1).expression()).variables())
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
    nodes.add(
        new Node("input", "INPUT", "Input", new Position(0, 0), null, null, null, null, null));
    String previous = "input";
    for (int index = 0; index < 60; index++) {
      String id = "formula" + index;
      nodes.add(
          new Node(
              id,
              "FORMULA",
              "Formula " + index,
              new Position(0, (index + 1) * 100),
              "\"" + "x".repeat(1900) + "\"",
              "value" + index,
              null,
              null,
              null));
      edges.add(new Edge(previous + "-" + id, previous, id, "next"));
      previous = id;
    }
    nodes.add(
        new Node(
            "output",
            "OUTPUT",
            "Output",
            new Position(0, 6100),
            "value59",
            null,
            null,
            null,
            null));
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
