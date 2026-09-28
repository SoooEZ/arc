package dev.arc.engine.execution;

import static dev.arc.support.GraphFixtures.inputNode;
import static dev.arc.support.GraphFixtures.outputNode;
import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.SourceReader;
import dev.arc.engine.expression.Expressions;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.rule.RuleSamples;
import dev.arc.source.JsonPointerExtractor;
import java.math.BigDecimal;
import java.util.*;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class ParametersTest {
  private final JsonPointerExtractor extractor = new JsonPointerExtractor();
  private final SourceReader source =
      (binding, inputs, deadline) -> {
        if (!Objects.equals(inputs.get("key"), "US")) throw ArcException.invalid("Missing key");
        return extractor.extract(
            Map.of("rate", 0.07, "version", binding.version()), binding.pointer());
      };

  /** Resolves as an execution without Formula calls does, compiling source arguments on demand. */
  private static Map<String, Object> resolve(
      Parameters parameters, List<Input> declared, Map<String, Object> supplied) {
    return parameters.resolve(
        declared,
        supplied,
        Expressions::compile,
        ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS),
        Expressions.FormulaCaller.unavailable());
  }

  private Input rate(String policy) {
    return new Input(
        "rate",
        "NUMBER",
        true,
        new BigDecimal("0.01"),
        new SourceBinding("country-tax", 2, Map.of("key", "country"), "/rate", policy));
  }

  @Test
  void fetchesDependenciesRegardlessOfDeclarationOrderAndCallerWins() {
    var inputs = List.of(rate("FAIL"), new Input("country", "STRING", true, "US"));
    var p = new Parameters(source);
    assertThat(resolve(p, inputs, Map.of()).get("rate")).isEqualTo(new BigDecimal("0.07"));
    assertThat(p.reads().getFirst().version()).isEqualTo(2);
    var supplied = new Parameters(source);
    assertThat(resolve(supplied, inputs, Map.of("rate", 0.5, "country", "missing")).get("rate"))
        .isEqualTo(new BigDecimal("0.5"));
    assertThat(supplied.reads()).isEmpty();
  }

  @Test
  void explicitFallbackHandlesMissingPointerFetchAndWrongType() {
    var inputs = List.of(rate("DEFAULT"), new Input("country", "STRING", true, "missing"));
    var p = new Parameters(source);
    assertThat(resolve(p, inputs, Map.of()).get("rate")).isEqualTo(new BigDecimal("0.01"));
    assertThat(p.reads().getFirst().status()).isEqualTo("DEFAULT");
    assertThatThrownBy(
            () -> resolve(new Parameters(source), List.of(rate("FAIL"), inputs.get(1)), Map.of()))
        .hasMessageContaining("Missing key");
    assertThatThrownBy(() -> resolve(new Parameters(source), inputs, Map.of("rate", "0.5")))
        .hasMessageContaining("must be number");
    assertThatThrownBy(() -> extractor.extract(Map.of("a", 1), "/missing"))
        .hasMessageContaining("pointer");
  }

  @Test
  void anOverallDeadlineCannotBeHiddenByTheDefaultFallback() {
    SourceReader expired =
        (binding, inputs, deadline) -> {
          throw new ArcException(504, "Rule execution deadline exceeded");
        };
    var parameters = List.of(rate("DEFAULT"), new Input("country", "STRING", true, "US"));
    assertThatThrownBy(
            () ->
                new Parameters(expired)
                    .resolve(
                        parameters,
                        Map.of(),
                        Expressions::compile,
                        ExecutionDeadline.start(30_000),
                        Expressions.FormulaCaller.unavailable()))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
  }

  @Test
  void aValueReadAfterTheDeadlineIsNeverUsedEvenIfTheReaderIgnoresTheDeadline() {
    SourceReader late =
        (binding, inputs, deadline) -> {
          java.util.concurrent.locks.LockSupport.parkNanos(150_000_000);
          return BigDecimal.ONE;
        };
    var parameters = List.of(rate("DEFAULT"), new Input("country", "STRING", true, "US"));
    assertThatThrownBy(
            () ->
                new Parameters(late)
                    .resolve(
                        parameters,
                        Map.of(),
                        Expressions::compile,
                        ExecutionDeadline.start(100),
                        Expressions.FormulaCaller.unavailable()))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> assertThat(error.kind()).isEqualTo(ArcException.Kind.DEADLINE));
  }

  @Test
  void anExhaustedExecutionBudgetCannotBeHiddenByTheDefaultFallback() {
    SourceReader exhausted =
        (binding, inputs, deadline) -> {
          throw ArcException.limit("Execution exceeds 50 source reads");
        };
    var parameters = List.of(rate("DEFAULT"), new Input("country", "STRING", true, "US"));
    assertThatThrownBy(() -> resolve(new Parameters(exhausted), parameters, Map.of()))
        .isInstanceOfSatisfying(
            ArcException.class,
            error -> {
              assertThat(error.kind()).isEqualTo(ArcException.Kind.LIMIT);
              assertThat(error.getMessage()).isEqualTo("Execution exceeds 50 source reads");
            });
  }

  /**
   * Declarations of the same eight dependencies. Each differs from alphabetical and source order,
   * and each starts with a different input, so no single hash order can match all of them.
   */
  private static final List<List<String>> DECLARATION_ORDERS =
      List.of(
          List.of("c", "h", "a", "f", "d", "b", "g", "e"),
          List.of("e", "g", "b", "d", "f", "a", "h", "c"),
          List.of("g", "a", "e", "c", "h", "f", "b", "d"));

  /** A total whose source argument reads every dependency, declared before all of them. */
  private static List<Input> totalThen(List<String> order, Function<String, Input> dependency) {
    var inputs = new ArrayList<Input>();
    inputs.add(
        new Input(
            "total",
            "NUMBER",
            true,
            null,
            new SourceBinding("sum", 1, Map.of("v", "a + b + c + d + e + f + g + h"), "", "FAIL")));
    for (String name : order) inputs.add(dependency.apply(name));
    return inputs;
  }

  private static Input sourced(String name) {
    return new Input(
        name, "NUMBER", true, null, new SourceBinding("src-" + name, 1, Map.of(), "", "FAIL"));
  }

  @Test
  void sourceDependenciesResolveInDeclarationOrderInsteadOfHashOrder() {
    for (List<String> order : DECLARATION_ORDERS) {
      var attempted = new ArrayList<String>();
      SourceReader reader =
          (binding, inputs, deadline) -> {
            attempted.add(binding.id());
            return BigDecimal.ONE;
          };
      var expected = new ArrayList<>(order);
      expected.add("total");
      var parameters = new Parameters(reader);
      var values = resolve(parameters, totalThen(order, ParametersTest::sourced), Map.of());
      assertThat(parameters.reads()).extracting(Parameters.Read::input).isEqualTo(expected);
      assertThat(attempted.getLast()).isEqualTo("sum");
      assertThat(values.keySet()).containsExactlyElementsOf(expected);

      var definition =
          new Definition(
              1,
              totalThen(order, ParametersTest::sourced),
              List.of(inputNode("input", "Inputs"), outputNode("out", "Total", "total")),
              List.of(new Edge("input-out", "input", "out", "next")));
      var result =
          new Engine(new Validator())
              .execute(
                  "rule", 1, definition, Map.of(), (id, version) -> null, new Parameters(reader));
      assertThat(result.result()).isEqualTo(BigDecimal.ONE);
      assertThat(result.sources()).extracting(Parameters.Read::input).isEqualTo(expected);
      var inputTrace = (Map<?, ?>) result.trace().getFirst().value();
      assertThat(List.copyOf(inputTrace.keySet())).isEqualTo(expected);
    }
  }

  @Test
  void theFirstDeclaredDependencyReportsAMissingValueOrAFailedRead() {
    for (List<String> order : DECLARATION_ORDERS) {
      String first = order.getFirst();
      var plain = totalThen(order, name -> new Input(name, "NUMBER", true, null));
      assertThatThrownBy(() -> resolve(new Parameters(source), plain, Map.of()))
          .hasMessage("Missing required input: " + first);

      var attempted = new ArrayList<String>();
      var failing =
          new Parameters(
              (binding, inputs, deadline) -> {
                attempted.add(binding.id());
                throw ArcException.invalid("HTTP 503 from " + binding.id());
              });
      assertThatThrownBy(
              () -> resolve(failing, totalThen(order, ParametersTest::sourced), Map.of()))
          .hasMessage(first + ": HTTP 503 from src-" + first);
      assertThat(attempted).containsExactly("src-" + first);
    }
  }

  @Test
  void rejectsDependencyCyclesBeforeFetching() {
    var a =
        new Input(
            "a",
            "NUMBER",
            true,
            null,
            new SourceBinding("source", 1, Map.of("key", "b"), "", "FAIL"));
    var b =
        new Input(
            "b",
            "NUMBER",
            true,
            null,
            new SourceBinding("source", 1, Map.of("key", "a"), "", "FAIL"));
    var blank = RuleSamples.blank("FORMULA");
    var d = new Definition(1, List.of(a, b), blank.nodes(), blank.edges());
    assertThatThrownBy(() -> new Validator().validate(d, (id, v) -> null))
        .hasMessageContaining("Circular source");
  }

  @Test
  void mappingArgumentFailuresNameTheMappingWhileFailedReadsNameTheInput() {
    // A failed mapping argument surfaced as the bare "Division by zero" at the Input node.
    var rate =
        new Input(
            "rate",
            "NUMBER",
            true,
            null,
            new SourceBinding("country-tax", 2, Map.of("key", "1 / zero"), "/rate", "FAIL"));
    var inputs = List.of(rate, new Input("zero", "NUMBER", true, 0));
    assertThatThrownBy(() -> resolve(new Parameters(source), inputs, Map.of()))
        .hasMessage("rate source / key: Division by zero");
    var unmatched = List.of(rate("FAIL"), new Input("country", "STRING", true, "XX"));
    assertThatThrownBy(() -> resolve(new Parameters(source), unmatched, Map.of()))
        .hasMessage("rate: Missing key");
  }
}
