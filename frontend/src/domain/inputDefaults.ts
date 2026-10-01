import type { InputType } from "../types";
import { isDecimalNumber, isJsonObject } from "./json";
import {
  formatLimit,
  MAX_COLLECTION_ITEMS,
  MAX_STRING_CHARACTERS,
  MAX_VALUE_DEPTH,
  MAX_VALUE_ELEMENTS,
} from "./limits";
import { unsupportedNumber, withinServerLimits } from "./numericDefaults";
import { storableTextProblem } from "./serverText";

const typeProblems: Partial<Record<InputType, string>> = {
  ARRAY: "An ARRAY default must be a JSON array such as [1, 2].",
  OBJECT: 'An OBJECT default must be a JSON object such as {"key": 1}.',
};

/** The server's own words (ValueBounds), so the field explains what the save would say. */
export const valueBoundProblems = {
  sizeOrDepth: "Value exceeds collection depth or size limit",
  string: `String exceeds ${formatLimit(MAX_STRING_CHARACTERS)} characters`,
  array: `Array exceeds ${formatLimit(MAX_COLLECTION_ITEMS)} items`,
  object: `Object exceeds ${formatLimit(MAX_COLLECTION_ITEMS)} fields`,
};

/**
 * Why the server would refuse `value` as the default of an input of `type`, or
 * null: the declared type (InputTypes.check, where an OBJECT is a plain JSON
 * object and never an array) and the value bounds of everything in it
 * (ValueBounds: nesting depth, element count, text length, array and object
 * sizes, and the number limits). A JSON default field applies it before the
 * value reaches the draft, so the save it would fail is refused in the field.
 */
export function inputDefaultProblem(
  type: InputType,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  const typeProblem = typeProblems[type];
  if (typeProblem && !hasJsonType(type, value)) return typeProblem;
  return valueBoundProblem(value);
}

function hasJsonType(type: InputType, value: unknown): boolean {
  if (type === "ARRAY") return Array.isArray(value);
  if (type === "OBJECT") return isJsonObject(value);
  return true;
}

/**
 * The first problem the server's ValueBounds.bound would report, in its
 * order: every value is visited depth first, keys before values, with an
 * explicit stack so a very large paste cannot exhaust the call stack.
 */
function valueBoundProblem(root: unknown): string | null {
  const pending: { value: unknown; depth: number }[] = [
    { value: root, depth: 0 },
  ];
  let elements = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > MAX_VALUE_DEPTH || ++elements > MAX_VALUE_ELEMENTS)
      return valueBoundProblems.sizeOrDepth;
    if (typeof value === "number" || isDecimalNumber(value)) {
      // The save request carries the DecimalNumber's own token and JSON's spelling of a double.
      const token = isDecimalNumber(value) ? value.text : JSON.stringify(value);
      if (!withinServerLimits(token)) return unsupportedNumber;
    } else if (typeof value === "string") {
      if (value.length > MAX_STRING_CHARACTERS)
        return valueBoundProblems.string;
      // Text and keys the database cannot hold fail the save (StorableText).
      const unstorable = storableTextProblem(value);
      if (unstorable) return unstorable;
    } else if (Array.isArray(value)) {
      if (value.length > MAX_COLLECTION_ITEMS) return valueBoundProblems.array;
      for (let index = value.length - 1; index >= 0; index--)
        pending.push({ value: value[index], depth: depth + 1 });
    } else if (isJsonObject(value)) {
      const entries = Object.entries(value);
      if (entries.length > MAX_COLLECTION_ITEMS)
        return valueBoundProblems.object;
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, field] = entries[index];
        pending.push({ value: field, depth: depth + 1 });
        pending.push({ value: key, depth: depth + 1 });
      }
    }
  }
  return null;
}
