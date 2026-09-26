package dev.arc.engine.script;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Functions;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.rule.RuleSamples;
import java.util.*;
import org.junit.jupiter.api.Test;

class NodeEditorTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final RuleResolver noRefs = (id, v) -> RuleSamples.blank("FORMULA");

  @Test
  void executableFunctionsHaveUsefulCategories() {
    var available = Functions.catalog().stream().filter(Functions.Entry::supported).toList();
    assertThat(available).hasSizeGreaterThan(150);
    assertThat(available)
        .noneMatch(f -> Set.of("Excel", "Workbook & other").contains(f.category()));
    assertThat(available.stream().map(Functions.Entry::category).distinct().count())
        .isGreaterThan(10);
  }

  @Test
  void editsOneNodePreservingEverythingElse() {
    Definition d =
        script.parse(
            """
            // preserve this note
            inputs { amount: NUMBER required default 10; }
            node input INPUT "Input" { next -> calc; }
            node calc FORMULA "Calc" at (20, 30) { let total = amount * 2; next -> out; }
            node out OUTPUT "Output" { return total; }
            """);
    String source = script.renderNode(d, "calc");
    assertThat(source)
        .contains("let total", "next ->")
        .doesNotContain("node \"input\"", "inputs {");
    var result = script.buildNode(d, "calc", source.replace("amount * 2", "amount * 3"));
    assertThat(result.diagnostics()).isEmpty();
    assertThat(result.definition().inputs()).isEqualTo(d.inputs());
    assertThat(result.definition().notes()).isEqualTo(d.notes());
    assertThat(result.definition().nodes().get(0)).isEqualTo(d.nodes().get(0));
    assertThat(result.definition().nodes().get(2)).isEqualTo(d.nodes().get(2));
    assertThat(result.definition().nodes().get(1).expression()).isEqualTo("amount * 3");
    assertThat(result.definition().edges()).containsExactlyInAnyOrderElementsOf(d.edges());
    assertThat(script.buildNode(d, "calc", source.replace("amount * 2", "amount *")).definition())
        .isNull();
    assertThat(
            script
                .buildNode(d, "calc", source.replace("node \"calc\"", "node \"other\""))
                .definition())
        .isNull();
    assertThat(
            script
                .buildNode(d, "calc", source.replace("-> \"out\"", "-> \"missing\""))
                .definition())
        .isNull();
  }

  @Test
  void inputNodeIncludesParametersAndSourceMappings() {
    var d =
        script.parse(
            """
inputs {
  country: STRING required default "US";
  rate: NUMBER required;
  source rate = {"id":"tax","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"FAIL"};
}
node input INPUT "Input" { next -> out; }
node out OUTPUT "Output" { return rate; }
""");
    var source = script.renderNode(d, "input");
    assertThat(source).contains("source rate", "country: STRING");
    var built = script.buildNode(d, "input", source.replace("default \"US\"", "default \"GB\""));
    assertThat(built.definition().inputs().getFirst().defaultValue()).isEqualTo("GB");
    assertThat(built.definition().inputs().get(1).source()).isEqualTo(d.inputs().get(1).source());
  }

  @Test
  void emptyTransformsGeneratePrefixedFunctionsWithoutRewritingExistingExpressions() {
    var draft =
        new Definition(
            1,
            List.of(),
            List.of(
                new Definition.Node(
                    "input",
                    "INPUT",
                    "Input",
                    new Definition.Position(0, 0),
                    null,
                    null,
                    null,
                    null,
                    null),
                node("transform", "TRANSFORM", null, "data"),
                new Definition.Node(
                    "out",
                    "OUTPUT",
                    "Output",
                    new Definition.Position(600, 0),
                    "data",
                    null,
                    null,
                    null,
                    null)),
            List.of(
                new Definition.Edge("start", "input", "transform", "next"),
                new Definition.Edge("done", "transform", "out", "next")));
    String fragment = script.renderNode(draft, "transform");
    assertThat(fragment).contains("let data = $OBJECT();");
    var built = script.buildNode(draft, "transform", fragment);
    assertThat(built.diagnostics()).isEmpty();
    assertThat(built.definition().nodes().get(1).expression()).isEqualTo("$OBJECT()");
    String canonical = script.render(built.definition());
    assertThat(script.build(canonical).definition()).isEqualTo(built.definition());
    assertThat(script.render(script.build(canonical).definition())).isEqualTo(canonical);
    validator.validate(built.definition(), noRefs);

    var legacy = script.buildNode(draft, "transform", fragment.replace("$OBJECT()", "OBJECT()"));
    assertThat(legacy.diagnostics()).isEmpty();
    assertThat(script.renderNode(legacy.definition(), "transform"))
        .contains("let data = OBJECT();")
        .doesNotContain("$OBJECT()");
  }

  private Definition.Node node(String id, String type, String expression, String output) {
    return new Definition.Node(id, type, id, null, expression, output, null, null, null);
  }

  @Test
  void diagnosticsReportEveryBadNodeEvenBeforeConnectionsAreComplete() {
    var d =
        new Definition(
            1,
            List.of(),
            List.of(
                node("input", "INPUT", null, null),
                node("bad", "FORMULA", "missing + 1", "x"),
                node("out", "OUTPUT", "1 +", null)),
            List.of());
    var issues = validator.diagnostics(d, noRefs);
    assertThat(issues.stream().flatMap(p -> p.locations().stream()).map(l -> l.nodeId()))
        .contains("input", "bad", "out");
    assertThat(issues.stream().map(Validator.Problem::message))
        .anyMatch(m -> m.contains("missing"));
  }

  @Test
  void diagnosticsAttributeNestedBindingExpressionsToTheirOwner() {
    var child =
        script.parse(
            "inputs { x: NUMBER required; } node in INPUT \"In\" { next -> out; } node out OUTPUT"
                + " \"Out\" { return x; }");
    var d =
        script.parse(
            "node input INPUT \"Input\" { next -> reuse; } node reuse REFERENCE \"Reuse\" { use"
                + " \"child\" version 1; bind x = unknown; as result; next -> out; } node out"
                + " OUTPUT \"Out\" { return result; }");
    var issues = validator.diagnostics(d, (id, v) -> child);
    assertThat(issues).hasSize(1);
    assertThat(issues.getFirst().locations().getFirst().nodeId()).isEqualTo("reuse");
    assertThat(issues.getFirst().message()).contains("unknown", "x");
  }
}
