package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.graph.GraphPlan;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class ValueSwitchTest {
  private final ObjectMapper json = new ObjectMapper();
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(json, validator);
  private final Engine engine = new Engine(validator);
  private final RuleResolver noRefs =
      (id, version) -> {
        throw new AssertionError("Unexpected reference");
      };

  private Definition choice() {
    return script.parse(
        """
        inputs { data: OBJECT required; }
        node input INPUT "Input" { next -> choose; }
        node choose SWITCH "Choose value" {
          select data.value;
          case boolean "Boolean" equals false;
          case number "Number" equals 0;
          case string "String" equals "0";
          case decimal "Decimal" equals 1.0;
          case duplicate "Duplicate" equals 1;
          case unicode "Unicode" equals "雪😀\\b\\f";
          case empty "Empty" equals "";
          case:boolean -> boolean;
          case:number -> number;
          case:string -> string;
          case:decimal -> decimal;
          case:duplicate -> duplicate;
          case:unicode -> unicode;
          case:empty -> empty;
          default -> fallback;
        }
        node boolean FORMULA "Boolean" { let result = "boolean"; next -> out; }
        node number FORMULA "Number" { let result = "number"; next -> out; }
        node string FORMULA "String" { let result = "string"; next -> out; }
        node decimal FORMULA "Decimal" { let result = "decimal"; next -> out; }
        node duplicate FORMULA "Duplicate" { let result = "duplicate"; next -> out; }
        node unicode FORMULA "Unicode" { let result = "unicode"; next -> out; }
        node empty FORMULA "Empty" { let result = "empty"; next -> out; }
        node fallback FORMULA "Fallback" { let result = "default"; next -> out; }
        node out OUTPUT "Output" { return result; }
        """);
  }

  private Engine.Result run(Definition definition, Object value) {
    return engine.execute(
        "test", 1, definition, Map.of("data", Collections.singletonMap("value", value)), noRefs);
  }

  @Test
  void matchesStrictScalarTypesAndDecimalsWithFirstMatchPriority() {
    var graph = choice();
    assertThat(run(graph, false).result()).isEqualTo("boolean");
    assertThat(run(graph, 0).result()).isEqualTo("number");
    assertThat(run(graph, "0").result()).isEqualTo("string");
    assertThat(run(graph, new BigDecimal("1.000")).result()).isEqualTo("decimal");
    assertThat(run(graph, "雪😀\b\f").result()).isEqualTo("unicode");
    assertThat(run(graph, "").result()).isEqualTo("empty");
    for (Object value : List.of(true, "false", "1", 2))
      assertThat(run(graph, value).result()).isEqualTo("default");
    assertThat(run(graph, new BigDecimal("1.00")).trace())
        .extracting(Engine.Step::nodeId)
        .containsExactly("input", "choose", "decimal", "out");
    assertThat(run(graph, 1).trace().get(1).branch()).isEqualTo("case:decimal");
    assertThat(new GraphPlan(graph).available().get("out")).contains("data", "result");
  }

  @Test
  void evaluatesSelectorOnceAndSkipsLaterCasesAfterAMatch() {
    var graph = script.parse(script.render(choice()).replace("equals 0;", "equals 1 / 0;"));
    assertThat(run(graph, false).result()).isEqualTo("boolean");
    assertThatThrownBy(() -> run(graph, true))
        .hasMessageContaining("Case Number: Division by zero");
    int[] reads = {0};
    var data =
        new HashMap<String, Object>(Map.of("value", "0")) {
          @Override
          public Object get(Object key) {
            reads[0]++;
            return super.get(key);
          }
        };
    assertThat(engine.execute("test", 1, choice(), Map.of("data", data), noRefs).result())
        .isEqualTo("string");
    assertThat(reads[0]).isEqualTo(1);
  }

  @Test
  void invalidSelectorAndReachedCaseTypesHaveLocatedValidationErrors() {
    for (Object value : Arrays.asList(null, List.of(1), Map.of("x", 1)))
      assertThatThrownBy(() -> run(choice(), value))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).contains("Selector", "boolean, number or string");
                assertThat(error.locations().getFirst().nodeId()).isEqualTo("choose");
              });
    for (String expression : List.of("null", "[1]", "$OBJECT()")) {
      var graph =
          script.parse(script.render(choice()).replace("equals 0;", "equals " + expression + ";"));
      assertThat(run(graph, false).result()).isEqualTo("boolean");
      assertThatThrownBy(() -> run(graph, true))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).contains("Case Number", "boolean, number or string");
                assertThat(error.locations().getFirst().nodeId()).isEqualTo("choose");
              });
    }
  }

  @Test
  void selectorParticipatesInScopeValidationAndCyclicGraphSyntaxDiagnostics() {
    var missing =
        script.parse(script.render(choice()).replace("select data.value;", "select missing;"));
    assertThat(validator.diagnostics(missing, noRefs))
        .anySatisfy(
            problem -> {
              assertThat(problem.message()).contains("Selector", "missing");
              assertThat(problem.locations().getFirst().nodeId()).isEqualTo("choose");
            });
    var graph = choice();
    var nodes =
        graph.nodes().stream()
            .map(node -> node.type().equals("SWITCH") ? withSelector(node, "1 +") : node)
            .toList();
    var edges = new ArrayList<>(graph.edges());
    edges.add(new Edge("cycle", "out", "choose", "next"));
    var cyclic = new Definition(1, graph.inputs(), nodes, edges);
    assertThat(validator.diagnostics(cyclic, noRefs))
        .anySatisfy(
            problem -> {
              assertThat(problem.message()).contains("Incomplete expression");
              assertThat(problem.locations().getFirst().nodeId()).isEqualTo("choose");
            });
    assertThat(validator.diagnostics(cyclic, noRefs))
        .anyMatch(problem -> problem.message().contains("cycles"));
  }

  @Test
  void scriptNodeJsonAndPublishedPlanSnapshotsPreserveSelector() throws Exception {
    var graph = choice();
    String canonical = script.render(graph);
    assertThat(canonical).contains("select data.value;", "equals false;").doesNotContain(" when ");
    assertThat(script.parse(canonical)).isEqualTo(graph);
    assertThat(json.readValue(json.writeValueAsString(graph), Definition.class)).isEqualTo(graph);
    var rebuilt = script.buildNode(graph, "choose", script.renderNode(graph, "choose"));
    assertThat(rebuilt.diagnostics()).isEmpty();
    assertThat(rebuilt.definition().nodes()).isEqualTo(graph.nodes());
    assertThat(rebuilt.definition().edges()).containsExactlyInAnyOrderElementsOf(graph.edges());
    assertThat(rebuilt.definition().inputs()).isEqualTo(graph.inputs());
    var plans = new ExecutionPlans(validator);
    var first =
        plans.session(noRefs, ExecutionDeadline.start(30_000), true).prepare("test", 1, graph);
    assertThat(first.definition().nodes().get(1).selector()).isEqualTo("data.value");
    assertThat(first.expression("data.value").evaluate(Map.of("data", Map.of("value", false))))
        .isEqualTo(false);
    assertThat(
            plans.session(noRefs, ExecutionDeadline.start(30_000), true).prepare("test", 1, graph))
        .isSameAs(first);
    String casesFirst =
        canonical
            .replace("  select data.value;\n", "")
            .replace("  default ->", "  select data.value;\n  default ->");
    assertThat(script.parse(casesFirst)).isEqualTo(graph);
  }

  @Test
  void scriptRejectsMixedCaseModesAndMisplacedSelectors() {
    String canonical = script.render(choice());
    for (String invalid :
        List.of(
            canonical.replace("select data.value;", ""),
            canonical.replace("equals", "when"),
            canonical.replace("equals false;", "when false;"),
            canonical.replace("select data.value;", "select data.value; select true;"),
            canonical.replace("return result;", "return result; select true;")))
      assertThat(script.build(invalid).diagnostics()).isNotEmpty();
  }

  @Test
  void selectorShapeRetainsExpressionBoundsAndNodeOwnership() {
    var graph = choice();
    for (Node invalid :
        List.of(
            withSelector(graph.nodes().get(1), "x".repeat(2001)),
            withSelector(graph.nodes().getFirst(), "true"))) {
      var nodes =
          graph.nodes().stream()
              .map(node -> node.id().equals(invalid.id()) ? invalid : node)
              .toList();
      assertThatThrownBy(
              () -> validator.shape(new Definition(1, graph.inputs(), nodes, graph.edges())))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.status()).isEqualTo(422);
                assertThat(error.getMessage()).containsIgnoringCase("selector");
                assertThat(error.locations().getFirst().nodeId()).isEqualTo(invalid.id());
              });
    }
  }

  @Test
  void legacyPredicateSwitchKeepsIgnoringPreviouslyUnusedExpression() throws Exception {
    var graph =
        script.parse(
            """
            inputs { amount: NUMBER required; }
            node input INPUT "Input" { next -> choose; }
            node choose SWITCH "Range" {
              case low "Low" when amount < 50;
              case medium "Medium" when amount < 100;
              case:low -> low; case:medium -> medium; default -> high;
            }
            node low OUTPUT "Low" { return 1; }
            node medium OUTPUT "Medium" { return 2; }
            node high OUTPUT "High" { return 3; }
            """);
    var stored = json.valueToTree(graph);
    ((com.fasterxml.jackson.databind.node.ObjectNode) stored.get("nodes").get(1))
        .put("expression", "missing + 1");
    graph = json.treeToValue(stored, Definition.class);
    for (var example : Map.of("49.999", "1", "50", "2", "99.999", "2", "100", "3").entrySet())
      assertThat(
              engine
                  .execute(
                      "legacy",
                      1,
                      graph,
                      Map.of("amount", new BigDecimal(example.getKey())),
                      noRefs)
                  .result())
          .isEqualTo(new BigDecimal(example.getValue()));
  }

  private Node withSelector(Node node, String selector) {
    return new Node(
        node.id(),
        node.type(),
        node.label(),
        node.position(),
        node.expression(),
        node.output(),
        node.ruleId(),
        node.version(),
        node.bindings(),
        node.cases(),
        node.fields(),
        selector);
  }
}
