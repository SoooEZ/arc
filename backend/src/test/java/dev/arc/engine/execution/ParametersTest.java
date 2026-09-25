package dev.arc.engine.execution;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.junit.jupiter.api.Test;

class ParametersTest {
  private final JsonPointerExtractor extractor = new JsonPointerExtractor(new ObjectMapper());
  private final SourceReader source =
      (binding, inputs) -> {
        if (!Objects.equals(inputs.get("key"), "US")) throw ArcException.invalid("Missing key");
        return extractor.extract(
            Map.of("rate", 0.07, "version", binding.version()), binding.pointer());
      };

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
    assertThat(p.resolve(inputs, Map.of()).get("rate")).isEqualTo(new BigDecimal("0.07"));
    assertThat(p.reads().getFirst().version()).isEqualTo(2);
    var supplied = new Parameters(source);
    assertThat(supplied.resolve(inputs, Map.of("rate", 0.5, "country", "missing")).get("rate"))
        .isEqualTo(new BigDecimal("0.5"));
    assertThat(supplied.reads()).isEmpty();
  }

  @Test
  void explicitFallbackHandlesMissingPointerFetchAndWrongType() {
    var inputs = List.of(rate("DEFAULT"), new Input("country", "STRING", true, "missing"));
    var p = new Parameters(source);
    assertThat(p.resolve(inputs, Map.of()).get("rate")).isEqualTo(new BigDecimal("0.01"));
    assertThat(p.reads().getFirst().status()).isEqualTo("DEFAULT");
    assertThatThrownBy(
            () -> new Parameters(source).resolve(List.of(rate("FAIL"), inputs.get(1)), Map.of()))
        .hasMessageContaining("Missing key");
    assertThatThrownBy(() -> new Parameters(source).resolve(inputs, Map.of("rate", "0.5")))
        .hasMessageContaining("must be number");
    assertThatThrownBy(() -> extractor.extract(Map.of("a", 1), "/missing"))
        .hasMessageContaining("pointer");
  }

  @Test
  void anOverallDeadlineCannotBeHiddenByTheDefaultFallback() {
    SourceReader expired =
        (binding, inputs) -> {
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
                        ExecutionDeadline.start(30_000)))
        .isInstanceOfSatisfying(
            ArcException.class, error -> assertThat(error.status()).isEqualTo(504));
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
}
