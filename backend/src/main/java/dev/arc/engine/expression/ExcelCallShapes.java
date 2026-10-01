package dev.arc.engine.expression;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import org.apache.poi.ss.formula.eval.BoolEval;
import org.apache.poi.ss.formula.eval.ErrorEval;
import org.apache.poi.ss.formula.eval.EvaluationException;
import org.apache.poi.ss.formula.eval.NumberEval;
import org.apache.poi.ss.formula.eval.OperandResolver;
import org.apache.poi.ss.formula.eval.StringEval;
import org.apache.poi.ss.formula.eval.ValueEval;
import org.apache.poi.ss.formula.functions.Finance;

/**
 * Calls that Excel accepts and POI implements differently or not at all, adapted before POI runs so
 * that every shape the catalog advertises answers as in Excel. POI's ROMAN needs its form and reads
 * TRUE as form 1, its INDEX fails on an area number, its IPMT refuses the future value and payment
 * type and its PPMT ignores them, its CODE answers text, and its COUNTA advertises a call without
 * arguments that Excel refuses.
 */
final class ExcelCallShapes {
  /** Fewer arguments than POI's metadata allows, where Excel refuses the shorter call. */
  static final Map<String, Integer> MINIMUM_ARGUMENTS = Map.of("COUNTA", 1);

  private ExcelCallShapes() {}

  /**
   * The answer of a call: POI's, with the arguments or the result adapted where POI differs from
   * Excel.
   */
  static ValueEval evaluate(String name, ValueEval[] values, Function<ValueEval[], ValueEval> poi) {
    return switch (name) {
      case "ROMAN" -> poi.apply(romanArguments(values));
      case "INDEX" -> values.length == 4 ? indexWithArea(values, poi) : poi.apply(values);
      case "IPMT", "PPMT" -> values.length > 4 ? paymentPart(name, values) : poi.apply(values);
      case "CODE" -> codeNumber(poi.apply(values));
      default -> poi.apply(values);
    };
  }

  /** Excel's form defaults to 0 (classic); TRUE is classic and FALSE simplified (form 4). */
  private static ValueEval[] romanArguments(ValueEval[] values) {
    if (values.length == 1) return new ValueEval[] {values[0], new NumberEval(0)};
    if (values.length == 2 && values[1] instanceof BoolEval form)
      return new ValueEval[] {values[0], new NumberEval(form.getBooleanValue() ? 0 : 4)};
    return values;
  }

  /** An array has one area: area 1 is the array itself, and any other area is #REF!. */
  private static ValueEval indexWithArea(ValueEval[] values, Function<ValueEval[], ValueEval> poi) {
    try {
      int area = OperandResolver.coerceValueToInt(OperandResolver.getSingleValue(values[3], 0, 0));
      return area == 1 ? poi.apply(Arrays.copyOf(values, 3)) : ErrorEval.REF_INVALID;
    } catch (EvaluationException error) {
      return error.getErrorEval();
    }
  }

  /** POI's CODE answers the character code as text; Excel's answers a number. */
  private static ValueEval codeNumber(ValueEval result) {
    return result instanceof StringEval code
        ? new NumberEval(Integer.parseInt(code.getStringValue()))
        : result;
  }

  /**
   * IPMT or PPMT with a future value and a payment type, through POI's own finance formulas. A
   * payment at the start of the first period pays no interest, which POI's formula misses.
   */
  private static ValueEval paymentPart(String name, ValueEval[] values) {
    try {
      double rate = number(values[0]);
      int period = (int) number(values[1]);
      int periods = (int) number(values[2]);
      double present = number(values[3]);
      double future = number(values[4]);
      int type = values.length > 5 && number(values[5]) != 0 ? 1 : 0;
      double interest =
          period == 1 && type == 1 ? 0 : Finance.ipmt(rate, period, periods, present, future, type);
      double result =
          name.equals("IPMT")
              ? interest
              : Finance.pmt(rate, periods, present, future, type) - interest;
      return Double.isFinite(result) ? new NumberEval(result) : ErrorEval.NUM_ERROR;
    } catch (EvaluationException error) {
      return error.getErrorEval();
    }
  }

  private static double number(ValueEval value) throws EvaluationException {
    return OperandResolver.coerceValueToDouble(OperandResolver.getSingleValue(value, 0, 0));
  }
}
