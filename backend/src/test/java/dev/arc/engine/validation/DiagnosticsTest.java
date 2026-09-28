package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;
import dev.arc.error.ArcException.Location;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleSamples;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** One diagnostics pass reports each fault once, with its label, at the node that owns it. */
class DiagnosticsTest {
  private final Validator validator = new Validator();
  private final RuleResolver noRules =
      (id, version) -> {
        throw new ArcException(404, "Published rule version not found: " + id + " v" + version);
      };

  @Test
  void sourceMappingProblemsAreReportedOnceWithTheSameLabelAsValidation() {
    var mappings = new TreeMap<>(Map.of("region", "missing", "zone", "gone"));
    var definition = sourced(new SourceBinding("rates", 1, mappings, null, "FAIL"));

    assertThat(validator.diagnostics(definition, noRules))
        .containsExactly(
            atInput("rate source / region: Variables unavailable on every incoming path: missing"),
            atInput("rate source / zone: Variables unavailable on every incoming path: gone"));
    assertThatThrownBy(() -> validator.validate(definition, noRules))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.getMessage())
                  .isEqualTo(
                      "rate source / region: Variables unavailable on every incoming path:"
                          + " missing");
              assertThat(error.locations()).containsExactly(inputLocation());
            });
  }

  @Test
  void cyclicGraphsKeepTheLabelOfEveryBrokenExpression() {
    var shape =
        nodeOf("t", "TRANSFORM", "Shape")
            .at(0, 0)
            .output("data")
            .fields(List.of(new Field("ok", "1"), new Field("name", "$UPPER(")))
            .build();
    var reuse =
        nodeOf("r", "REFERENCE", "Reuse")
            .at(0, 0)
            .output("reused")
            .rule("child", 1)
            .bindings(Map.of("amount", "1 +"))
            .build();
    var definition =
        new Definition(
            1,
            List.of(),
            List.of(node("input", "INPUT", null, null), route("$ROUND("), shape, reuse),
            List.of(
                edge("input", "s", "next"),
                edge("s", "t", "case:ok"),
                edge("s", "r", "case:broken"),
                edge("s", "t", "default"),
                edge("t", "r", "next"),
                edge("r", "s", "next")));

    var problems = validator.diagnostics(definition, noRules);

    assertThat(problems).anyMatch(problem -> problem.message().contains("cycles"));
    assertThat(problems)
        .contains(
            new Validator.Problem("Route / Selector: " + syntaxError("$ROUND("), at("s", "Route")),
            new Validator.Problem(
                "Shape / Field name: " + syntaxError("$UPPER("), at("t", "Shape")),
            new Validator.Problem("Reuse / amount: " + syntaxError("1 +"), at("r", "Reuse")));
    var selfLoop =
        new Definition(
            1,
            List.of(),
            List.of(node("input", "INPUT", null, null), route(null)),
            List.of(edge("input", "s", "next"), edge("s", "s", "default")));
    assertThat(validator.diagnostics(selfLoop, noRules))
        .contains(
            new Validator.Problem("Route / Case Broken: " + syntaxError("1 +"), at("s", "Route")));
  }

  private static Node route(String selector) {
    return nodeOf("s", "SWITCH", "Route")
        .at(0, 0)
        .cases(
            List.of(
                new BranchCase("ok", "Fine", "true"), new BranchCase("broken", "Broken", "1 +")))
        .selector(selector)
        .build();
  }

  @Test
  void connectionShapeProblemsBelongToTheNodeTheyLeave() {
    var nodes =
        List.of(
            node("input", "INPUT", null, null),
            node("check", "CONDITION", "true", null),
            node("yes", "OUTPUT", "1", null));
    var dangling =
        List.of(
            edge("input", "check", "next"),
            edge("check", "yes", "true"),
            edge("check", "gone", "false"));
    var handle =
        List.of(
            edge("input", "check", "next"),
            edge("check", "yes", "true"),
            new Edge("maybe", "check", "yes", "maybe"));
    var duplicate =
        List.of(
            edge("input", "check", "next"),
            new Edge("dup", "check", "yes", "true"),
            new Edge("dup", "check", "yes", "false"));
    var orphan =
        List.of(
            edge("input", "check", "next"),
            edge("check", "yes", "true"),
            edge("check", "yes", "false"),
            edge("ghost", "yes", "next"));
    assertShapeProblem(nodes, dangling, "Connection refers to a missing node", "check");
    assertShapeProblem(nodes, handle, "Invalid connection handle", "check");
    assertShapeProblem(nodes, duplicate, "Every connection needs a unique ID", "check");
    assertShapeProblem(nodes, orphan, "Connection refers to a missing node", "yes");
  }

  @Test
  void diagnosticsCheckEachFormulaCallOnceLikeExecutableValidation() {
    var library =
        new Definition(
            1,
            List.of(new Input("a", "NUMBER", true, null)),
            List.of(node("input", "INPUT", null, null), node("out", "OUTPUT", "a", null)),
            List.of(edge("input", "out", "next")));
    var resolutions = new AtomicInteger();
    RuleResolver counting =
        new RuleResolver() {
          @Override
          public Definition resolve(String id, int version) {
            return library;
          }

          @Override
          public Definition resolveFormula(String id, int version) {
            resolutions.incrementAndGet();
            return library;
          }
        };
    var nodes = new ArrayList<Node>(List.of(node("input", "INPUT", null, null)));
    var edges = new ArrayList<Edge>();
    String previous = "input";
    for (int index = 1; index <= 3; index++) {
      String id = "f" + index;
      nodes.add(node(id, "FORMULA", "@lib:1(amount) + " + index, "r" + index));
      edges.add(edge(previous, id, "next"));
      previous = id;
    }
    nodes.add(node("out", "OUTPUT", "r3", null));
    edges.add(edge(previous, "out", "next"));
    var definition =
        new Definition(1, List.of(new Input("amount", "NUMBER", true, null)), nodes, edges);

    validator.compile(definition, counting);
    int executable = resolutions.getAndSet(0);
    var diagnosis = validator.diagnose(definition, counting);

    assertThat(diagnosis.problems()).isEmpty();
    assertThat(resolutions.get()).isEqualTo(executable).isEqualTo(3);
    assertThat(diagnosis.dependencies())
        .extracting(Validator.Dependency::nodeId)
        .containsExactly("f1", "f2", "f3");
  }

  @Test
  void aBrokenSourceMappingNoLongerHidesGraphStructureProblems() {
    var definition = sourced(new SourceBinding("rates", 1, Map.of("key", "missing"), null, "FAIL"));
    var unconnected = new ArrayList<>(definition.nodes());
    unconnected.add(node("extra", "OUTPUT", "1", null));

    assertThat(
            validator.diagnostics(
                new Definition(1, definition.inputs(), unconnected, definition.edges()), noRules))
        .extracting(Validator.Problem::message)
        .containsExactly(
            "rate source / key: Variables unavailable on every incoming path: missing",
            "Every node must be reachable from Input; connect or remove unused nodes");
  }

  @Test
  void inputCyclesNameTheFirstDeclaredInput() {
    var blank = RuleSamples.blank("FORMULA");
    var zeta =
        new Input(
            "zeta",
            "NUMBER",
            true,
            null,
            new SourceBinding("s", 1, Map.of("k", "alpha"), "", "FAIL"));
    var alpha =
        new Input(
            "alpha",
            "NUMBER",
            true,
            null,
            new SourceBinding("s", 1, Map.of("k", "zeta"), "", "FAIL"));
    var definition = new Definition(1, List.of(zeta, alpha), blank.nodes(), blank.edges());
    assertThatThrownBy(() -> validator.validate(definition, noRules))
        .hasMessage("Circular source parameter dependency: zeta");
  }

  @Test
  void aDraftMayChooseARuleBeforeItsVersionButNotTheReverse() {
    for (Integer version : Arrays.asList(null, 1)) validator.shape(reference("child", version));
    assertThatThrownBy(() -> validator.shape(reference(null, 2)))
        .hasMessage("Ref: choose a rule before its version");
    for (int version : List.of(0, -1))
      assertThatThrownBy(() -> validator.shape(reference("child", version)))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo("Ref: rule versions start at 1");
                assertThat(error.locations())
                    .containsExactly(new Location(null, null, "ref", "Ref"));
              });
  }

  private void assertShapeProblem(
      List<Node> nodes, List<Edge> edges, String message, String nodeId) {
    var definition = new Definition(1, List.of(), nodes, edges);
    var located = List.of(new Location(null, null, nodeId, nodeId));
    assertThat(validator.diagnostics(definition, noRules))
        .containsExactly(new Validator.Problem(message, located));
    for (var check :
        List.<Runnable>of(
            () -> validator.shape(definition), () -> validator.validate(definition, noRules)))
      assertThatThrownBy(check::run)
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).isEqualTo(message);
                assertThat(error.locations()).isEqualTo(located);
              });
  }

  private static Definition sourced(SourceBinding source) {
    return new Definition(
        1,
        List.of(new Input("rate", "NUMBER", true, null, source)),
        List.of(node("input", "INPUT", null, null), node("out", "OUTPUT", "rate", null)),
        List.of(edge("input", "out", "next")));
  }

  private static Definition reference(String ruleId, Integer version) {
    var node =
        nodeOf("ref", "REFERENCE", "Ref")
            .output("value")
            .rule(ruleId, version)
            .bindings(Map.of())
            .build();
    return new Definition(1, List.of(), List.of(node), List.of());
  }

  private static Validator.Problem atInput(String message) {
    return new Validator.Problem(message, List.of(inputLocation()));
  }

  private static Location inputLocation() {
    return new Location(null, null, "input", "input");
  }

  private static List<Location> at(String nodeId, String label) {
    return List.of(new Location(null, null, nodeId, label));
  }

  private static String syntaxError(String expression) {
    try {
      Expressions.compile(expression);
    } catch (ArcException error) {
      return error.getMessage();
    }
    throw new AssertionError("Expected a syntax error: " + expression);
  }

  @Test
  void scopeFreeNodeChecksAndEveryStructureProblemSurviveACycle() {
    var amount = List.of(new Input("amount", "NUMBER", true, null));
    var f = nodeOf("f", "FORMULA", "F").at(0, 0).expression("1").output("").build();
    var w = nodeOf("w", "FORMULA", "W").at(0, 0).expression("1").output("amount").build();
    var r = nodeOf("r", "REFERENCE", "R").at(0, 0).rule("nope", 3).output("x").build();
    var s = nodeOf("s", "SWITCH", "S").at(0, 0).cases(List.of()).build();
    var nodes =
        List.of(node("input", "INPUT", null, null), f, w, r, s, node("out", "OUTPUT", "1", null));
    var edges =
        new ArrayList<>(
            List.of(
                edge("input", "f", "next"),
                edge("f", "w", "next"),
                edge("w", "r", "next"),
                edge("r", "s", "next"),
                edge("s", "out", "default")));
    var expected =
        List.of(
            new Validator.Problem("F: provide a valid result variable", at("f", "F")),
            new Validator.Problem("W: cannot overwrite input amount", at("w", "W")),
            new Validator.Problem("Published rule version not found: nope v3", at("r", "R")),
            new Validator.Problem("S: add at least one case", at("s", "S")));
    assertThat(validator.diagnostics(new Definition(1, amount, nodes, edges), noRules))
        .containsExactlyInAnyOrderElementsOf(expected);
    // Without a scope plan these four vanished until the cycle was fixed.
    edges.add(edge("out", "f", "next"));
    var problems = validator.diagnostics(new Definition(1, amount, nodes, edges), noRules);
    assertThat(problems).anyMatch(problem -> problem.message().contains("cycles"));
    assertThat(problems).containsAll(expected);
    assertThat(problems)
        .contains(new Validator.Problem("out: connect no outgoing branches", at("out", "out")));
  }

  @Test
  void everyMissingConnectionAndUnreachableNodeIsReported() {
    var definition =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                node("c1", "CONDITION", "true", null),
                node("c2", "CONDITION", "true", null),
                node("c3", "CONDITION", "true", null),
                node("out1", "OUTPUT", "1", null),
                node("out2", "OUTPUT", "2", null),
                node("out3", "OUTPUT", "3", null)),
            List.of(
                edge("input", "c1", "next"),
                edge("c1", "c2", "true"),
                edge("c2", "c3", "true"),
                edge("c3", "out1", "true")));
    String unreachable = "Every node must be reachable from Input; connect or remove unused nodes";
    // Only c1's problem was reported before, so the editor marked one node at a time.
    assertThat(validator.diagnostics(definition, noRules))
        .containsExactlyInAnyOrder(
            new Validator.Problem("c1: connect [true, false]", at("c1", "c1")),
            new Validator.Problem("c2: connect [true, false]", at("c2", "c2")),
            new Validator.Problem("c3: connect [true, false]", at("c3", "c3")),
            new Validator.Problem(unreachable, at("out2", "out2")),
            new Validator.Problem(unreachable, at("out3", "out3")));
    // Executable validation still stops at the first problem.
    assertThatThrownBy(() -> validator.validate(definition, noRules))
        .hasMessage("c1: connect [true, false]");
  }
}
