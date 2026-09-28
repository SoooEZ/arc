import type { InputType } from "../types";
import { isDecimalNumber, isJsonObject } from "./json";
import { unsupportedNumber, withinServerLimits } from "./numericDefaults";

const typeProblems: Partial<Record<InputType, string>> = {
  ARRAY: "An ARRAY default must be a JSON array such as [1, 2].",
  OBJECT: 'An OBJECT default must be a JSON object such as {"key": 1}.',
};

/**
 * Why the server would refuse `value` as the default of an input of `type`, or
 * null: the declared type (InputTypes.check, where an OBJECT is a plain JSON
 * object and never an array) and the number limits of every nested number
 * (Expressions.bounded). A JSON default field applies it before the value
 * reaches the draft, so the save it would fail is refused in the field.
 */
export function inputDefaultProblem(
  type: InputType,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  const typeProblem = typeProblems[type];
  if (typeProblem && !hasJsonType(type, value)) return typeProblem;
  return nestedNumberProblem(value);
}

function hasJsonType(type: InputType, value: unknown): boolean {
  if (type === "ARRAY") return Array.isArray(value);
  if (type === "OBJECT") return isJsonObject(value);
  return true;
}

/** The first number in `value`, at any depth, that the server's limits refuse. */
function nestedNumberProblem(value: unknown): string | null {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "number" || isDecimalNumber(current)) {
      // The save request carries the DecimalNumber's own token and JSON's spelling of a double.
      const token = isDecimalNumber(current)
        ? current.text
        : JSON.stringify(current);
      if (!withinServerLimits(token)) return unsupportedNumber;
    } else if (Array.isArray(current)) pending.push(...current);
    else if (isJsonObject(current)) pending.push(...Object.values(current));
  }
  return null;
}
