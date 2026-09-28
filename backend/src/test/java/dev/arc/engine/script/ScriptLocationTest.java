package dev.arc.engine.script;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.Limits;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.Edge;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** Build problems point at the statement that caused them, and generated IDs stay valid. */
class ScriptLocationTest {
  private final ArcScript script = new ArcScript(new ObjectMapper(), new Validator());

  @Test
  void implicitConnectionIdsStayWithinTheEdgeLimitForValidNodeIds() {
    String first = "a".repeat(47);
    String second = "b".repeat(48);
    String longest = "c".repeat(Limits.MAX_NODE_ID_CHARACTERS);
    String caseId = "k".repeat(Limits.MAX_CASE_ID_CHARACTERS);
    String source =
        """
        node %1$s INPUT "Input" { next -> %2$s; }
        node %2$s FORMULA "Second" { let second = 1; next -> %3$s; }
        node %3$s SWITCH "Longest" {
          case %4$s "Long case" when true;
          case:%4$s -> short_target;
          default -> short_target;
        }
        node short_target OUTPUT "Out" { return 1; }
        """
            .formatted(first, second, longest, caseId);

    var built = script.build(source);

    assertThat(built.diagnostics()).isEmpty();
    var ids = built.definition().edges().stream().map(Edge::id).toList();
    assertThat(ids)
        .doesNotHaveDuplicates()
        .allSatisfy(id -> assertThat(id.length()).isLessThanOrEqualTo(100));
    assertThat(script.build(source).definition()).isEqualTo(built.definition());
    assertThat(script.build(built.source()).definition()).isEqualTo(built.definition());
  }

  @Test
  void implicitConnectionIdsDistinguishConnectionsThatShareASpelling() {
    var built =
        script.build(
            """
            node a INPUT "Input" { next -> "b-next-c"; }
            node "b-next-c" FORMULA "B" { let b = 1; }
            node "a-next-b" FORMULA "A" { let d = 1; next -> c; }
            node c OUTPUT "C" { return 1; }
            """);
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.definition().edges()).extracting(Edge::id).doesNotHaveDuplicates();
  }

  @Test
  void readableConnectionIdsAreUnchangedForPlainNodeIds() {
    var built =
        script.build(
            """
            node input INPUT "Input" { next -> choose; }
            node choose SWITCH "Choose" { case premium "Premium" when true; case:premium -> out; default -> out; }
            node out OUTPUT "Out" { return 1; }
            """);
    assertThat(built.definition().edges())
        .extracting(Edge::id)
        .containsExactly("input-next-choose", "choose-case:premium-out", "choose-default-out");
  }

  @Test
  void shapeProblemsPointAtTheStatementThatDeclaredTheElement() {
    assertProblem(
        """
        inputs { amount: NUMBER required; }
        node input INPUT "Input" { next -> out; }
        node out OUTPUT "%s" { return amount; }
        """
            .formatted("x".repeat(161)),
        "Every node needs a label of 1 to 160 characters",
        3,
        1);
    assertProblem(
        """
        node input INPUT "Input" { next -> choose; }
        node choose SWITCH "Choose" {
          case ok "Fine" when true;
          case %s "Long" when true;
          default -> out;
        }
        node out OUTPUT "Out" { return 1; }
        """
            .formatted("k".repeat(65)),
        "Every case needs a unique, stable ID",
        4,
        3);
    assertProblem(
        """
        node input INPUT "Input" {
          next -> out;
          next -> missing;
        }
        node out OUTPUT "Out" { return 1; }
        """,
        "Connection refers to a missing node",
        3,
        3);
    assertProblem(
        """
        node input INPUT "Input" {
          next -> out edge "same";
          next -> other edge "same";
        }
        node out OUTPUT "Out" { return 1; }
        node other OUTPUT "Other" { return 2; }
        """,
        "Every connection needs a unique ID",
        3,
        3);
    assertProblem(
        """
        node input INPUT "Input" {
          next -> out edge "%s";
        }
        node out OUTPUT "Out" { return 1; }
        """
            .formatted("e".repeat(101)),
        "Every connection needs a unique ID",
        2,
        3);
    assertProblem(
        """
        inputs {
          amount: NUMBER required default "high";
        }
        node input INPUT "Input" {}
        """,
        "Input 'amount' must be number",
        2,
        3);
    assertProblem(
        """
        inputs {
          rate: NUMBER required;
          source rate = {"id":"Bad Id","version":1,"bindings":{},"onError":"FAIL"};
        }
        node input INPUT "Input" {}
        """,
        "Source needs an ID and version",
        3,
        3);
    assertProblem(
        """
        inputs {
          rate: NUMBER required;
          source other = {"id":"tax","version":1,"bindings":{},"onError":"FAIL"};
        }
        node input INPUT "Input" {}
        """,
        "Source refers to unknown input: other",
        3,
        3);
    assertProblem(
        "node input INPUT \"Input\" {}\n// %s\n".formatted("n".repeat(2_001)),
        "Too many or oversized comments",
        2,
        1);
    assertProblem(
        """
        node input INPUT "Input" {}
        node input OUTPUT "Again" { return 1; }
        """,
        "Duplicate node ID: input",
        2,
        1);
    assertProblem(
        """
        node input INPUT "Input" { next -> shape; }
        node shape TRANSFORM "Shape" {
          field "a" = 1;
          let data = 2;
        }
        """,
        "Transform uses either field mappings or one expression, not both",
        2,
        1);
  }

  @Test
  void nodeCodeProblemsPointAtTheFragment() {
    Definition graph =
        script
            .build(
                """
                node input INPUT "Input" { next -> out; }
                node out OUTPUT "Out" { return 1; }
                """)
            .definition();
    assertThat(
            script
                .buildNode(
                    graph,
                    "out",
                    "node out OUTPUT \"Out\" { return 1; }\nnode extra OUTPUT \"Extra\" { return 2; }")
                .diagnostics())
        .extracting(ArcScript.Diagnostic::line, ArcScript.Diagnostic::column)
        .containsExactly(tuple(2, 1));
    assertThat(
            script
                .buildNode(
                    graph,
                    "out",
                    "inputs {\n  amount: NUMBER required;\n}\nnode out OUTPUT \"Out\" { return 1; }")
                .diagnostics())
        .containsExactly(new ArcScript.Diagnostic("Edit parameters in the Input node.", 2, 3));
    assertThat(
            script
                .buildNode(
                    graph,
                    "out",
                    "\nnode out OUTPUT \"%s\" { return 1; }".formatted("x".repeat(161)))
                .diagnostics())
        .containsExactly(
            new ArcScript.Diagnostic("Every node needs a label of 1 to 160 characters", 2, 1));
  }

  @Test
  void longQuotedNamesProduceDiagnosticsOnASmallStack() throws Exception {
    String longText = "x".repeat(20_000);
    String escapes = "\\\"".repeat(10_000);
    Map<String, ArcScript.Diagnostic> expected = new LinkedHashMap<>();
    expected.put(
        "node out OUTPUT \"%s\" { return 1; }".formatted(longText),
        new ArcScript.Diagnostic("Every node needs a label of 1 to 160 characters", 1, 1));
    expected.put(
        "node out OUTPUT \"%s\" { return 1; }".formatted(escapes),
        new ArcScript.Diagnostic("Every node needs a label of 1 to 160 characters", 1, 1));
    expected.put(
        "node \"%s\" OUTPUT \"Out\" { return 1; }".formatted(longText),
        new ArcScript.Diagnostic("Every node needs a valid ID", 1, 1));
    expected.put(
        "node input INPUT \"Input\" {\n  next -> \"%s\";\n}".formatted(longText),
        new ArcScript.Diagnostic("Connection refers to a missing node", 2, 3));
    expected.put(
        "node input INPUT \"Input\" {\n  next -> input edge \"%s\";\n}".formatted(longText),
        new ArcScript.Diagnostic("Every connection needs a unique ID", 2, 3));
    expected.put(
        "node t TRANSFORM \"T\" {\n  field \"%s\" = 1;\n}".formatted(longText),
        new ArcScript.Diagnostic(
            "Transform fields need unique names of 1 to 160 characters", 2, 3));
    expected.put(
        "node s SWITCH \"S\" {\n  case a \"%s\" when true;\n}".formatted(longText),
        new ArcScript.Diagnostic("Every case needs a label of 1 to 160 characters", 2, 3));
    expected.put(
        "node r REFERENCE \"R\" {\n  use \"%s\" version 1;\n}".formatted(longText),
        new ArcScript.Diagnostic("R: choose a valid rule ID", 1, 1));

    var results = new LinkedHashMap<String, List<ArcScript.Diagnostic>>();
    var failure = new AtomicReference<Throwable>();
    Runnable builds =
        () -> {
          try {
            for (String source : expected.keySet())
              results.put(source, script.build(source).diagnostics());
          } catch (Throwable error) {
            failure.set(error);
          }
        };
    var thread = new Thread(null, builds, "small-stack", 256 * 1024);
    thread.start();
    thread.join();

    assertThat(failure.get()).isNull();
    for (var entry : expected.entrySet())
      if (entry.getValue() == null) assertThat(results.get(entry.getKey())).isEmpty();
      else assertThat(results.get(entry.getKey())).containsExactly(entry.getValue());
  }

  private void assertProblem(String source, String message, int line, int column) {
    var built = script.build(source);
    assertThat(built.definition()).as(message).isNull();
    assertThat(built.source()).isEqualTo(source);
    assertThat(built.diagnostics())
        .as(message)
        .containsExactly(new ArcScript.Diagnostic(message, line, column));
  }

  @Test
  void aMalformedReferencePinIsReportedAtItsNode() {
    // The build accepted `use "Bad ID!"` before; the pin failed later as a 404.
    assertThat(
            script.build("node r REFERENCE \"R\" {\n  use \"Bad ID!\" version 1;\n}").diagnostics())
        .containsExactly(new ArcScript.Diagnostic("R: choose a valid rule ID", 1, 1));
  }

  @Test
  void implicitDuplicateConnectionsStillFailAtTheSecondStatement() {
    String source =
        "node input INPUT \"Input\" {\n  next -> out;\n  next -> out;\n}\n"
            + "node out OUTPUT \"Out\" { return 1; }";
    assertThat(script.build(source).diagnostics())
        .containsExactly(new ArcScript.Diagnostic("Duplicate statement: next:out", 3, 3));
  }
}
