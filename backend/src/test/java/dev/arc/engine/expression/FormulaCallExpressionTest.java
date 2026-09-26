package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import dev.arc.engine.ExecutionDeadline;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class FormulaCallExpressionTest {
  @Test
  void compilationExposesPinsInSourceOrderWithoutTreatingThemAsVariables() {
    var expression = Expressions.compile("@outer-rule:3(@child:1(amount), $ROUND(rate, 2))");
    assertThat(expression.variables()).containsExactlyInAnyOrder("amount", "rate");
    assertThat(expression.formulaCalls())
        .containsExactly(
            new Expressions.FormulaCall("outer-rule", 3, 2),
            new Expressions.FormulaCall("child", 1, 1));
    assertThatThrownBy(() -> expression.formulaCalls().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThat(Expressions.compile("'@child:1(amount)' + \"@other:2()\"").formulaCalls()).isEmpty();
  }

  @Test
  void formulaCallsRemainLazyAndKeepCollectionLocalsAndExplicitNullArguments() {
    var calls = new ArrayList<List<Object>>();
    Expressions.FormulaCaller caller =
        (reference, arguments) -> {
          calls.add(arguments);
          return arguments.getFirst();
        };
    var expression = Expressions.compile("$MAP(items, amount, @identity:1(amount))");
    assertThat(expression.variables()).containsExactly("items");
    assertThat(
            expression.evaluate(
                Map.of("items", List.of(1, 2)), ExecutionDeadline.start(30_000), caller))
        .isEqualTo(List.of(1, 2));
    assertThat(
            Expressions.compile("$IF(false, @identity:1(1/0), 5)")
                .evaluate(Map.of(), ExecutionDeadline.start(30_000), caller))
        .isEqualTo(new BigDecimal("5"));
    assertThat(
            Expressions.compile("@identity:1(null)")
                .evaluate(Map.of(), ExecutionDeadline.start(30_000), caller))
        .isNull();
    assertThat(calls).containsExactly(List.of(1), List.of(2), Arrays.asList((Object) null));
  }

  @Test
  void callsNeedExplicitPositivePinsAndAHostAtExecutionTime() {
    for (String invalid :
        List.of(
            "@child(1)",
            "@child:0(1)",
            "@child:01(1)",
            "@child:2147483648(1)",
            "@Bad:1(1)",
            "@child:1"))
      assertThatThrownBy(() -> Expressions.compile(invalid))
          .as(invalid)
          .isInstanceOf(dev.arc.error.ArcException.class);
    assertThatThrownBy(() -> Expressions.evaluate("@child:1(1)", Map.of()))
        .hasMessage("Published Formula calls need a rule execution context");
    assertThat(Expressions.compile("$IF(true, 2, @child:1(1))").evaluate(Map.of()))
        .isEqualTo(new BigDecimal("2"));
  }
}
