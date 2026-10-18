import type { TestCase } from "../types";
import {
  isDecimalNumber,
  isJsonObject,
  sameJsonValue,
  stringifyJson,
  type DecimalNumber,
} from "./json";

/** What one run of a saved test produced: the rule's result, or the message it failed with. */
export type TestRun = { result: unknown } | { error: string };

/** Whether a run meets its test, and why not. */
export interface TestOutcome {
  passed: boolean;
  /** For a failed test, what happened instead of what it expects. */
  reason: string | null;
}

function isNumber(value: unknown): value is number | DecimalNumber {
  return typeof value === "number" || isDecimalNumber(value);
}

/**
 * Whether two JSON values are equal as the expression language compares
 * them: numbers by decimal value (120 equals 120.00), arrays item by item in
 * order, objects field by field whatever their order.
 */
export function sameResult(left: unknown, right: unknown): boolean {
  if (isNumber(left) || isNumber(right))
    return isNumber(left) && isNumber(right) && sameJsonValue(left, right);
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameResult(item, right[index]))
    );
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && sameResult(left[key], right[key]),
      )
    );
  }
  return left === right;
}

/** A value as one line of JSON, shortened for a list: strings quoted, numbers as written. */
export function valueText(value: unknown, limit = 60): string {
  const text = value === undefined ? "nothing" : stringifyJson(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const passed: TestOutcome = { passed: true, reason: null };
const failed = (reason: string): TestOutcome => ({ passed: false, reason });

/** Whether `run` meets `test`: the expected result, or a failure whose message contains the expected text. */
export function testOutcome(
  test: Pick<TestCase, "expectedResult" | "expectedError">,
  run: TestRun,
): TestOutcome {
  if (test.expectedError !== null) {
    if (!("error" in run))
      return failed(`Returned ${valueText(run.result)} instead of failing`);
    return run.error.includes(test.expectedError)
      ? passed
      : failed(`Failed with “${run.error}”`);
  }
  if ("error" in run) return failed(`Failed: ${run.error}`);
  return sameResult(test.expectedResult, run.result)
    ? passed
    : failed(
        `Returned ${valueText(run.result)}, expected ${valueText(test.expectedResult)}`,
      );
}

/** The inputs as a short line, "orderTotal 150 · customerTier "premium"", or "No inputs". */
export function inputsText(inputs: Record<string, unknown>): string {
  const entries = Object.entries(inputs);
  if (!entries.length) return "No inputs";
  return entries
    .map(([name, value]) => `${name} ${valueText(value, 30)}`)
    .join(" · ");
}

/** A name for a new test from its inputs, which the user may change. */
export function suggestedTestName(inputs: Record<string, unknown>): string {
  const text = Object.entries(inputs)
    .map(([name, value]) => {
      const shown = typeof value === "string" ? value : valueText(value, 20);
      return `${name} ${shown}`;
    })
    .join(", ");
  const name = text || "No inputs";
  return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}
