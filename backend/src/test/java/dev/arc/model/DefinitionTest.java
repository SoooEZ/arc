package dev.arc.model;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.model.Definition.*;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DefinitionTest {
  @Test
  void theInputNodeIsTheFirstInputInDocumentOrder() {
    var first = inputNode("first", "First");
    var second = inputNode("second", "Second");
    var out = outputNode("out", "Out", "1");
    var draft = new Definition(1, List.of(), List.of(out, first, second), List.of());
    assertThat(draft.inputNode()).containsSame(first);
    assertThat(draft.nodesOf(NodeKind.INPUT)).containsExactly(first, second);
    assertThat(draft.nodesOf(NodeKind.OUTPUT)).containsExactly(out);
    assertThat(new Definition(1, List.of(), List.of(out), List.of()).inputNode()).isEmpty();
  }

  @Test
  void findingTheInputNodeAcceptsDocumentsThatShapeValidationRejects() {
    assertThat(new Definition(1, List.of(), null, List.of()).inputNode()).isEmpty();
    var input = inputNode("in", "In");
    var nodes =
        Arrays.asList(
            null, nodeOf("x", null, "X").build(), nodeOf("y", "input", "Y").build(), input);
    assertThat(new Definition(1, List.of(), nodes, List.of()).inputNode()).containsSame(input);
  }

  @Test
  void aDetachedCopyKeepsEveryFieldButSharesNoCollectionWithTheCaller() {
    var items = new ArrayList<Object>(List.of(new BigDecimal("1")));
    var defaultValue = new ArrayList<Object>(List.of(new LinkedHashMap<>(Map.of("items", items))));
    var sourceBindings = new LinkedHashMap<>(Map.of("key", "country"));
    var bindings = new LinkedHashMap<>(Map.of("amount", "amount"));
    var cases = new ArrayList<>(List.of(new BranchCase("big", "Big", "1")));
    var fields = new ArrayList<>(List.of(new Field("value", "amount")));
    var every =
        nodeOf("every", "SWITCH", "Every")
            .at(1, 2)
            .expression("amount")
            .output("result")
            .rule("child", 3)
            .bindings(bindings)
            .cases(cases)
            .fields(fields)
            .selector("amount")
            .outputName("total")
            .build();
    var inputs =
        new ArrayList<>(
            List.of(
                new Input(
                    "rows",
                    "ARRAY",
                    false,
                    defaultValue,
                    new SourceBinding("rates", 2, sourceBindings, "/rows", "DEFAULT"))));
    var nodes = new ArrayList<>(List.of(inputNode("in", "In"), every));
    var edges = new ArrayList<>(List.of(new Edge("e", "in", "every", "next")));
    var notes = new ArrayList<>(List.of("note"));
    var definition = new Definition(1, inputs, nodes, edges, notes);

    Definition detached = definition.detached();

    assertThat(detached).isEqualTo(definition);
    items.add(new BigDecimal("2"));
    sourceBindings.put("other", "1");
    bindings.put("rate", "1");
    cases.clear();
    fields.clear();
    nodes.clear();
    edges.clear();
    notes.clear();
    inputs.clear();
    var copy = detached.nodes().get(1);
    assertThat(copy.bindings()).containsOnlyKeys("amount");
    assertThat(copy.cases()).hasSize(1);
    assertThat(copy.fields()).hasSize(1);
    assertThat(detached.edges()).hasSize(1);
    assertThat(detached.notes()).containsExactly("note");
    var input = detached.inputs().getFirst();
    assertThat(input.source().bindings()).containsOnlyKeys("key");
    var frozenItems =
        (List<?>) ((Map<?, ?>) ((List<?>) input.defaultValue()).getFirst()).get("items");
    assertThat(frozenItems).isEqualTo(List.of(new BigDecimal("1")));
    assertThatThrownBy(() -> detached.nodes().add(copy))
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> copy.bindings().put("rate", "1"))
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> input.source().bindings().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> frozenItems.clear()).isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void detachingLeavesMalformedPartsForValidationToReport() {
    var withoutNodes = new Definition(1, List.of(), null, List.of());
    assertThat(withoutNodes.detached()).isSameAs(withoutNodes);
    var withNulls =
        new Definition(
            1,
            Arrays.asList((Input) null),
            Arrays.asList((Node) null),
            Arrays.asList((Edge) null),
            null);
    var copy = withNulls.detached();
    assertThat(copy.inputs()).containsExactly((Input) null);
    assertThat(copy.nodes()).containsExactly((Node) null);
    assertThat(copy.edges()).containsExactly((Edge) null);
    assertThat(copy.notes()).isNull();
  }

  @Test
  void aDetachedSourceDefinitionFreezesLookupEntriesAndKeepsStoredNulls() {
    var rate = new ArrayList<Object>(List.of(new BigDecimal("0.07")));
    var entries = new LinkedHashMap<String, Object>(Map.of("US", rate));
    var headers = new LinkedHashMap<String, String>();
    headers.put("X-Key", null);
    var parameters = new ArrayList<>(List.of(new Input("key", "STRING", true, null)));
    var source = new SourceDefinition("LOOKUP", null, parameters, entries, headers, 1000);

    var detached = source.detached();

    assertThat(detached).isEqualTo(source);
    rate.clear();
    parameters.clear();
    assertThat(detached.entries().get("US")).isEqualTo(List.of(new BigDecimal("0.07")));
    assertThat(detached.parameters()).hasSize(1);
    assertThat(detached.secretHeaders()).containsEntry("X-Key", null);
    assertThatThrownBy(() -> ((List<?>) detached.entries().get("US")).clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThat(new SourceDefinition("HTTP", "u", null, null, null, 0).detached())
        .isEqualTo(new SourceDefinition("HTTP", "u", null, null, null, 0));
  }
}
