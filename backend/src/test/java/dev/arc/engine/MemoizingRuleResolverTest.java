package dev.arc.engine;

import static dev.arc.support.GraphFixtures.calculation;
import static org.assertj.core.api.Assertions.*;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class MemoizingRuleResolverTest {
  @Test
  void cachesImmutablePinsPerRequestAndKeepsVersionsSeparate() {
    var calls = new AtomicInteger();
    RuleResolver storage =
        (id, version) -> {
          calls.incrementAndGet();
          return calculation();
        };
    var first = new MemoizingRuleResolver(storage);
    assertThat(first.resolve("child", 1)).isSameAs(first.resolve("child", 1));
    first.resolve("child", 2);
    first.resolve("other", 1);
    assertThat(calls).hasValue(3);
    new MemoizingRuleResolver(storage).resolve("child", 1);
    assertThat(calls).hasValue(4);
  }

  @Test
  void ordinaryResolutionDoesNotBypassFormulaKindChecksAndSuccessfulFormulaPinsAreShared() {
    var ordinary = new AtomicInteger();
    var formulas = new AtomicInteger();
    RuleResolver storage =
        new RuleResolver() {
          @Override
          public dev.arc.model.Definition resolve(String id, int version) {
            ordinary.incrementAndGet();
            return calculation();
          }

          @Override
          public dev.arc.model.Definition resolveFormula(String id, int version) {
            formulas.incrementAndGet();
            return calculation();
          }
        };
    var resolver = new MemoizingRuleResolver(storage);
    resolver.resolve("child", 1);
    assertThat(resolver.resolveFormula("child", 1)).isSameAs(resolver.resolveFormula("child", 1));
    assertThat(ordinary).hasValue(1);
    assertThat(formulas).hasValue(1);
    var firstFormula = resolver.resolveFormula("child", 2);
    assertThat(resolver.resolve("child", 2)).isSameAs(firstFormula);
    assertThat(ordinary).hasValue(1);
    assertThat(formulas).hasValue(2);
    RuleResolver referenceOnly = (id, version) -> calculation();
    assertThatThrownBy(() -> referenceOnly.resolveFormula("child", 1))
        .hasMessageContaining("unavailable");
  }
}
