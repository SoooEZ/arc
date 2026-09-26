package dev.arc.engine.validation;

import dev.arc.engine.RuleResolver;
import dev.arc.engine.expression.Expressions;
import dev.arc.error.ArcException;

/**
 * Published Formula contracts are checked without executing the callee or reading source values.
 */
final class FormulaCallValidation {
  static void validate(Expressions.Compiled expression, RuleResolver resolver) {
    for (var call : expression.formulaCalls()) {
      var inputs = resolver.resolveFormula(call.id(), call.version()).inputs();
      String name = "@" + call.id() + ":" + call.version();
      if (call.argumentCount() > inputs.size())
        throw ArcException.invalid(name + " accepts at most " + inputs.size() + " arguments");
      for (int index = call.argumentCount(); index < inputs.size(); index++) {
        var input = inputs.get(index);
        if (input.required() && input.defaultValue() == null && input.source() == null)
          throw ArcException.invalid(
              name + " needs argument " + (index + 1) + " (" + input.name() + ")");
      }
    }
  }

  private FormulaCallValidation() {}
}
