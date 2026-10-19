package dev.arc.engine.validation;

import static dev.arc.support.GraphFixtures.*;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.Limits;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

/**
 * Draft shape has two sides: structure, which {@code /variables} needs to build a scope plan, and
 * content, which only a save, a publish or diagnostics report. One table holds a fixture for every
 * content message and one for every structural message, so a check placed on the wrong side fails
 * here instead of making {@code /variables} fail for the whole draft and blanking every inspector.
 */
class DefinitionShapeTest {
  private final Validator validator = new Validator();
  private final Definition valid = calculation();

  @Test
  void contentProblemsPassTheStructureCheckAndFailTheShapeCheck() {
    var fixtures = new LinkedHashMap<String, Definition>();
    fixtures.put(
        "Too many or oversized comments",
        new Definition(
            1,
            valid.inputs(),
            valid.nodes(),
            valid.edges(),
            List.of("n".repeat(Limits.MAX_NOTE_CHARACTERS + 1))));
    fixtures.put(
        "Node position must be finite and within canvas bounds",
        withNode(copyOf(calculate()).at(Limits.MAX_CANVAS_COORDINATE + 1, 0).build()));
    fixtures.put(
        "Every node needs a label of 1 to 160 characters",
        withNode(nodeOf("calculate", "FORMULA", "").expression("1").output("total").build()));
    fixtures.put(
        "Expressions belong to Formula, Condition, Transform and Output nodes",
        withNode(copyOf(valid.nodes().getFirst()).expression("1").build()));
    fixtures.put(
        "Expression exceeds 2,000 characters",
        withNode(
            copyOf(calculate())
                .expression("1" + " ".repeat(Limits.MAX_EXPRESSION_CHARACTERS))
                .build()));
    fixtures.put(
        "Calculate: provide a valid result variable",
        withNode(copyOf(calculate()).output("1total").build()));
    fixtures.put(
        "Return total: provide a valid output name",
        withNode(copyOf(valid.nodes().get(2)).outputName("1total").build()));
    fixtures.put(
        "Selector expression exceeds 2,000 characters",
        withExtraNode(
            switchNode(List.of(new BranchCase("c", "C", "1")))
                .selector("1" + " ".repeat(Limits.MAX_EXPRESSION_CHARACTERS))
                .build()));
    fixtures.put(
        "Reuse: choose a valid rule ID", withExtraNode(reference().rule("Bad ID", 1).build()));
    fixtures.put(
        "Reuse: choose a rule before its version",
        withExtraNode(reference().rule(null, 1).build()));
    fixtures.put(
        "Reuse: rule versions start at 1", withExtraNode(reference().rule("child", 0).build()));
    fixtures.put(
        "Every case needs a label of 1 to 160 characters",
        withExtraNode(switchNode(List.of(new BranchCase("c", "", "1"))).build()));
    fixtures.put(
        "Case expression exceeds 2,000 characters or is missing",
        withExtraNode(switchNode(List.of(new BranchCase("c", "C", null))).build()));
    var tooManyFields = new ArrayList<Field>();
    for (int index = 0; index <= Limits.MAX_TRANSFORM_FIELDS; index++)
      tooManyFields.add(new Field("f" + index, "1"));
    fixtures.put(
        "Provide at most 50 transform fields",
        withExtraNode(transform().fields(tooManyFields).build()));
    fixtures.put(
        "Transform fields need unique names of 1 to 160 characters",
        withExtraNode(
            transform().fields(List.of(new Field("f", "1"), new Field("f", "2"))).build()));
    fixtures.put(
        "Field expression exceeds 2,000 characters or is missing",
        withExtraNode(transform().fields(List.of(new Field("f", null))).build()));
    fixtures.put(
        "Transform uses either field mappings or one expression, not both",
        withExtraNode(transform().fields(List.of(new Field("f", "1"))).expression("2").build()));
    var tooManyBindings = new LinkedHashMap<String, String>();
    for (int index = 0; index <= Limits.MAX_REFERENCE_BINDINGS; index++)
      tooManyBindings.put("b" + index, "1");
    fixtures.put(
        "Provide at most 50 parameter bindings",
        withExtraNode(reference().rule("child", 1).bindings(tooManyBindings).build()));
    fixtures.put(
        "Invalid parameter binding",
        withExtraNode(reference().rule("child", 1).bindings(Map.of("1x", "1")).build()));
    fixtures.put(
        "Input names must be identifiers (letters, digits, underscores)",
        withInput(new Input("and", "NUMBER", true, null)));
    fixtures.put("Unknown input type", withInput(new Input("amount", "DATE", true, null)));
    fixtures.put(
        "Input 'amount' must be number", withInput(new Input("amount", "NUMBER", true, "x")));
    fixtures.put(
        "Source needs an ID and version",
        withSource(new SourceBinding("Bad Id", 1, Map.of(), "", "FAIL")));
    var tooManyMappings = new LinkedHashMap<String, String>();
    for (int index = 0; index <= Limits.MAX_SOURCE_MAPPINGS; index++)
      tooManyMappings.put("m" + index, "1");
    fixtures.put(
        "Source needs up to 20 mappings",
        withSource(new SourceBinding("rates", 1, tooManyMappings, "", "FAIL")));
    fixtures.put(
        "Invalid source mapping",
        withSource(new SourceBinding("rates", 1, Map.of("1x", "1"), "", "FAIL")));
    fixtures.put(
        "Use a JSON pointer starting with /",
        withSource(new SourceBinding("rates", 1, Map.of(), "rate", "FAIL")));
    fixtures.put(
        "JSON pointer exceeds 500 characters",
        withSource(
            new SourceBinding(
                "rates", 1, Map.of(), "/" + "r".repeat(Limits.MAX_POINTER_CHARACTERS), "FAIL")));
    fixtures.put(
        "Choose FAIL or DEFAULT source error policy",
        withSource(new SourceBinding("rates", 1, Map.of(), "", "RETRY")));
    fixtures.put(
        "Source fallback requires a default value",
        withSource(new SourceBinding("rates", 1, Map.of(), "", "DEFAULT")));
    tableFixtures(fixtures);
    for (var fixture : fixtures.entrySet()) {
      assertThatThrownBy(() -> validator.shape(fixture.getValue()))
          .as("shape: " + fixture.getKey())
          .hasMessage(fixture.getKey());
      assertThatCode(() -> validator.structure(fixture.getValue()))
          .as("structure: " + fixture.getKey())
          .doesNotThrowAnyException();
    }
  }

  /** A decision table's columns and rows are content: the scope plan reads none of them. */
  private void tableFixtures(Map<String, Definition> fixtures) {
    var amount = List.of(new DecisionTable.Condition("Amount", "amount"));
    var fee = List.of(new DecisionTable.Result("fee"));
    var row = new DecisionTable.Row(List.of("-"), List.of("1"));
    validator.shape(withExtraNode(table(new DecisionTable(null, amount, fee, List.of(row)))));
    fixtures.put(
        "Tables belong to Decision table nodes",
        withNode(
            copyOf(calculate()).table(new DecisionTable(null, amount, fee, List.of(row))).build()));
    fixtures.put("Table: a decision table needs its table", withExtraNode(table(null)));
    fixtures.put(
        "Table: hitPolicy must be FIRST, UNIQUE or COLLECT",
        withExtraNode(table(new DecisionTable("first", amount, fee, List.of(row)))));
    fixtures.put(
        "Table: a decision table needs its conditions, results and rows lists",
        withExtraNode(table(new DecisionTable(null, amount, fee, null))));
    var conditions = new ArrayList<DecisionTable.Condition>();
    for (int index = 0; index <= Limits.MAX_TABLE_CONDITIONS; index++)
      conditions.add(new DecisionTable.Condition("C" + index, "1"));
    fixtures.put(
        "Provide at most 20 conditions",
        withExtraNode(table(new DecisionTable(null, conditions, fee, List.of()))));
    var results = new ArrayList<DecisionTable.Result>();
    for (int index = 0; index <= Limits.MAX_TABLE_RESULTS; index++)
      results.add(new DecisionTable.Result("r" + index));
    fixtures.put(
        "Provide at most 10 results",
        withExtraNode(table(new DecisionTable(null, amount, results, List.of()))));
    var rows = new ArrayList<DecisionTable.Row>();
    for (int index = 0; index <= Limits.MAX_TABLE_ROWS; index++) rows.add(row);
    fixtures.put(
        "Provide at most 200 rows",
        withExtraNode(table(new DecisionTable(null, amount, fee, rows))));
    fixtures.put(
        "Conditions need unique labels of 1 to 160 characters",
        withExtraNode(
            table(
                new DecisionTable(
                    null,
                    List.of(
                        new DecisionTable.Condition("Amount", "amount"),
                        new DecisionTable.Condition("Amount", "1")),
                    fee,
                    List.of()))));
    fixtures.put(
        "Condition expression exceeds 2,000 characters or is missing",
        withExtraNode(
            table(
                new DecisionTable(
                    null, List.of(new DecisionTable.Condition("A", null)), fee, List.of()))));
    fixtures.put(
        "Results need unique names: letters, digits and underscores, starting with a letter or"
            + " underscore",
        withExtraNode(
            table(
                new DecisionTable(
                    null, amount, List.of(new DecisionTable.Result("1fee")), List.of()))));
    fixtures.put(
        "Row 1 needs its tests and results",
        withExtraNode(
            table(
                new DecisionTable(
                    null, amount, fee, List.of(new DecisionTable.Row(null, List.of("1")))))));
    fixtures.put(
        "Row 1 has 2 tests, but the table has 1 condition",
        withExtraNode(
            table(
                new DecisionTable(
                    null,
                    amount,
                    fee,
                    List.of(new DecisionTable.Row(List.of("-", "-"), List.of("1")))))));
    fixtures.put(
        "Row 1 has 0 results, but the table has 1 result column",
        withExtraNode(
            table(
                new DecisionTable(
                    null, amount, fee, List.of(new DecisionTable.Row(List.of("-"), List.of()))))));
    fixtures.put(
        "Row 1: write every cell as text; - tests any value",
        withExtraNode(
            table(
                new DecisionTable(
                    null,
                    amount,
                    fee,
                    List.of(new DecisionTable.Row(Arrays.asList((String) null), List.of("1")))))));
    fixtures.put(
        "Row 1 has a cell that exceeds 2,000 characters",
        withExtraNode(
            table(
                new DecisionTable(
                    null,
                    amount,
                    fee,
                    List.of(
                        new DecisionTable.Row(
                            List.of("-"),
                            List.of("1" + " ".repeat(Limits.MAX_EXPRESSION_CHARACTERS))))))));
  }

  private static Node table(DecisionTable table) {
    return nodeOf("table", "DECISION_TABLE", "Table").output("fee").table(table).build();
  }

  @Test
  void structureProblemsFailBothChecks() {
    var fixtures = new LinkedHashMap<String, Definition>();
    fixtures.put(
        "Only schemaVersion 1 is supported",
        new Definition(2, valid.inputs(), valid.nodes(), valid.edges()));
    var tooManyInputs = new ArrayList<Input>();
    for (int index = 0; index <= Limits.MAX_INPUTS; index++)
      tooManyInputs.add(new Input("i" + index, "NUMBER", false, null));
    fixtures.put(
        "Provide at most 50 inputs",
        new Definition(1, tooManyInputs, valid.nodes(), valid.edges()));
    fixtures.put("Provide 1 to 100 nodes", new Definition(1, valid.inputs(), List.of(), List.of()));
    var tooManyEdges = new ArrayList<Edge>();
    for (int index = 0; index <= Limits.MAX_EDGES; index++)
      tooManyEdges.add(new Edge("e" + index, "input", "calculate", "next"));
    fixtures.put(
        "Provide at most 200 edges",
        new Definition(1, valid.inputs(), valid.nodes(), tooManyEdges));
    fixtures.put("Every node needs a valid ID", withExtraNode(outputNode("bad id", "Bad", "1")));
    fixtures.put("Duplicate node ID: calculate", withExtraNode(calculate()));
    fixtures.put("Unknown node type: LOOP", withExtraNode(nodeOf("loop", "LOOP", "Loop").build()));
    var tooManyCases = new ArrayList<BranchCase>();
    for (int index = 0; index <= Limits.MAX_SWITCH_CASES; index++)
      tooManyCases.add(new BranchCase("c" + index, "C", "1"));
    fixtures.put("Provide at most 20 cases", withExtraNode(switchNode(tooManyCases).build()));
    fixtures.put(
        "Every case needs a unique, stable ID",
        withExtraNode(
            switchNode(List.of(new BranchCase("c", "C", "1"), new BranchCase("c", "D", "2")))
                .build()));
    fixtures.put(
        "Every connection needs a unique ID",
        withEdges(List.of(new Edge("", "input", "calculate", "next"))));
    fixtures.put(
        "Connection refers to a missing node",
        withEdges(List.of(new Edge("gone", "input", "nowhere", "next"))));
    fixtures.put(
        "Invalid connection handle",
        withEdges(List.of(new Edge("maybe", "input", "calculate", "maybe"))));
    fixtures.put(
        "Input names must be identifiers (letters, digits, underscores)",
        withInput(new Input(null, "NUMBER", true, null)));
    fixtures.put(
        "Duplicate input: amount",
        new Definition(
            1,
            List.of(valid.inputs().getFirst(), valid.inputs().getFirst()),
            valid.nodes(),
            valid.edges()));
    for (var fixture : fixtures.entrySet()) {
      assertThatThrownBy(() -> validator.shape(fixture.getValue()))
          .as("shape: " + fixture.getKey())
          .hasMessage(fixture.getKey());
      assertThatThrownBy(() -> validator.structure(fixture.getValue()))
          .as("structure: " + fixture.getKey())
          .hasMessage(fixture.getKey());
    }
  }

  private Node calculate() {
    return valid.nodes().get(1);
  }

  /** The calculation with its Calculate node replaced. */
  private Definition withNode(Node replacement) {
    var nodes = new ArrayList<>(valid.nodes());
    for (int index = 0; index < nodes.size(); index++)
      if (nodes.get(index).id().equals(replacement.id())) nodes.set(index, replacement);
    return new Definition(1, valid.inputs(), nodes, valid.edges());
  }

  /** The calculation with one more node, which shape checks whether or not it is connected. */
  private Definition withExtraNode(Node extra) {
    var nodes = new ArrayList<>(valid.nodes());
    nodes.add(extra);
    return new Definition(1, valid.inputs(), nodes, valid.edges());
  }

  private Definition withEdges(List<Edge> edges) {
    return new Definition(1, valid.inputs(), valid.nodes(), edges);
  }

  private Definition withInput(Input input) {
    return new Definition(1, List.of(input), valid.nodes(), valid.edges());
  }

  private Definition withSource(SourceBinding source) {
    return withInput(new Input("rate", "NUMBER", true, null, source));
  }

  private static NodeBuilder switchNode(List<BranchCase> cases) {
    return nodeOf("route", "SWITCH", "Route").cases(cases);
  }

  private static NodeBuilder reference() {
    return nodeOf("reuse", "REFERENCE", "Reuse").output("reused");
  }

  private static NodeBuilder transform() {
    return nodeOf("shape", "TRANSFORM", "Shape").output("shaped");
  }
}
