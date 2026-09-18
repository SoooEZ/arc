package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import dev.arc.rule.RuleSamples;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class MemoizingRuleResolverTest {
  @Test
  void cachesImmutablePinsPerRequestAndKeepsVersionsSeparate() {
    var calls = new AtomicInteger();
    RuleResolver storage =
        (id, version) -> {
          calls.incrementAndGet();
          return RuleSamples.blank("FORMULA");
        };
    var first = new MemoizingRuleResolver(storage);
    assertThat(first.resolve("child", 1)).isSameAs(first.resolve("child", 1));
    first.resolve("child", 2);
    first.resolve("other", 1);
    assertThat(calls).hasValue(3);
    new MemoizingRuleResolver(storage).resolve("child", 1);
    assertThat(calls).hasValue(4);
  }
}
