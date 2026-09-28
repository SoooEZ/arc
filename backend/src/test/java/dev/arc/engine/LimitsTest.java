package dev.arc.engine;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.expression.Expressions;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class LimitsTest {
  private final Validator validator = new Validator();

  @Test
  void messagesShowLimitsWithCommaGroupingInEveryLocale() {
    Locale original = Locale.getDefault();
    try {
      for (Locale locale : List.of(Locale.GERMANY, Locale.FRANCE, Locale.forLanguageTag("hi-IN"))) {
        Locale.setDefault(locale);
        assertThat(Limits.format(Limits.MAX_EXPRESSION_CHARACTERS)).isEqualTo("2,000");
        assertThat(Limits.format(Limits.MAX_SCRIPT_CHARACTERS)).isEqualTo("1,048,576");
        assertThat(Limits.format(Limits.MAX_NESTING_DEPTH)).isEqualTo("16");
        assertThatThrownBy(() -> ExecutionDeadline.start(0))
            .hasMessage("Execution timeout must be 100–30,000 ms");
      }
    } finally {
      Locale.setDefault(original);
    }
  }

  /** Byte limits are stated from their constants too, in the units the messages always used. */
  @Test
  void byteSizesAreShownInWholeUnits() {
    assertThat(Limits.formatBytes(1024 * 1024)).isEqualTo("1 MiB");
    assertThat(Limits.formatBytes(16L * 1024 * 1024)).isEqualTo("16 MiB");
    assertThat(Limits.formatBytes(256 * 1024)).isEqualTo("256 KiB");
    assertThat(Limits.formatBytes(1_500)).isEqualTo("1,500 bytes");
  }

  /** Every place that stores an expression accepts exactly what the compiler accepts. */
  @Test
  void draftShapeAndCompilerShareTheExpressionLimit() {
    Map<String, Function<String, Node>> sites = new LinkedHashMap<>();
    sites.put(
        "Expression exceeds 2,000 characters",
        expression -> nodeOf("site", "FORMULA", "Site").expression(expression).output("v").build());
    sites.put(
        "Selector expression exceeds 2,000 characters",
        expression -> switchNode(List.of(new BranchCase("c", "C", "1")), expression));
    sites.put(
        "Case expression exceeds 2,000 characters or is missing",
        expression -> switchNode(List.of(new BranchCase("c", "C", expression)), null));
    sites.put(
        "Field expression exceeds 2,000 characters or is missing",
        expression ->
            nodeOf("site", "TRANSFORM", "Site")
                .output("v")
                .fields(List.of(new Field("f", expression)))
                .build());
    sites.put(
        "Invalid parameter binding",
        expression ->
            nodeOf("site", "REFERENCE", "Site")
                .output("v")
                .rule("child", 1)
                .bindings(Map.of("b", expression))
                .build());
    String longest = expressionOfLength(Limits.MAX_EXPRESSION_CHARACTERS);
    String tooLong = expressionOfLength(Limits.MAX_EXPRESSION_CHARACTERS + 1);
    Expressions.compile(longest);
    assertThatThrownBy(() -> Expressions.compile(tooLong))
        .hasMessage("Expression exceeds 2,000 characters");
    for (var site : sites.entrySet()) {
      validator.shape(withNode(site.getValue().apply(longest)));
      assertThatThrownBy(() -> validator.shape(withNode(site.getValue().apply(tooLong))))
          .as(site.getKey())
          .hasMessage(site.getKey());
    }
    validator.shape(withSourceMapping(longest));
    assertThatThrownBy(() -> validator.shape(withSourceMapping(tooLong)))
        .hasMessage("Invalid source mapping");
  }

  /** A number followed by spaces, so the compiler reaches its length check and nothing else. */
  private static String expressionOfLength(int length) {
    return "1" + " ".repeat(length - 1);
  }

  private static Node switchNode(List<BranchCase> cases, String selector) {
    return nodeOf("site", "SWITCH", "Site").cases(cases).selector(selector).build();
  }

  private static Definition withNode(Node site) {
    return new Definition(1, List.of(), List.of(inputNode("in", "Input"), site), List.of());
  }

  private static Definition withSourceMapping(String expression) {
    var binding = new SourceBinding("rates", 1, Map.of("key", expression), "", "FAIL");
    return new Definition(
        1,
        List.of(new Input("rate", "NUMBER", false, null, binding)),
        List.of(inputNode("in", "Input")),
        List.of());
  }
}
