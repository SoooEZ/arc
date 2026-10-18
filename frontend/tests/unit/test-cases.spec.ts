import { test, expect } from "@playwright/test";
import { DecimalNumber, parseJson, sameJsonValue } from "../../src/domain/json";
import {
  inputsText,
  sameResult,
  suggestedTestName,
  testOutcome,
} from "../../src/domain/testCases";
import { resultCounts } from "../../src/features/execution/testPanel/savedTests";
import type { TestCase } from "../../src/types";

test("numbers match by decimal value, whatever their places or spelling", () => {
  expect(sameJsonValue(120, new DecimalNumber("120.00"))).toBe(true);
  expect(sameJsonValue(new DecimalNumber("1.2e2"), 120)).toBe(true);
  expect(sameJsonValue(0, new DecimalNumber("-0.000"))).toBe(true);
  expect(sameJsonValue(new DecimalNumber("0.1"), 0.10000000000000001)).toBe(
    true,
  );
  expect(sameJsonValue(1, new DecimalNumber("1.0000000000000000001"))).toBe(
    false,
  );
});

test("results compare as the expression language compares values", () => {
  const read = (text: string) => parseJson(text);
  expect(
    sameResult(
      read('{"a": 1.50, "b": [1, "x"]}'),
      read('{"b": [1.0, "x"], "a": 1.5}'),
    ),
  ).toBe(true);
  expect(sameResult(read("[1, 2]"), read("[2, 1]"))).toBe(false);
  expect(sameResult(read('{"a": 1}'), read('{"a": 1, "b": null}'))).toBe(false);
  expect(sameResult(read("1"), read('"1"'))).toBe(false);
  expect(sameResult(null, null)).toBe(true);
  expect(sameResult(read("true"), read("1"))).toBe(false);
});

const test6 = {
  expectedResult: 6,
  expectedError: null,
} satisfies Pick<TestCase, "expectedResult" | "expectedError">;
const failing = {
  expectedResult: null,
  expectedError: "Missing required input",
} satisfies Pick<TestCase, "expectedResult" | "expectedError">;

test("a run passes on its expected result or on a failure containing the expected text", () => {
  expect(testOutcome(test6, { result: new DecimalNumber("6.00") })).toEqual({
    passed: true,
    reason: null,
  });
  expect(testOutcome(test6, { result: 9 })).toEqual({
    passed: false,
    reason: "Returned 9, expected 6",
  });
  expect(testOutcome(test6, { error: "Boom" })).toEqual({
    passed: false,
    reason: "Failed: Boom",
  });
  expect(
    testOutcome(failing, { error: "Missing required input: amount" }),
  ).toEqual({ passed: true, reason: null });
  expect(testOutcome(failing, { error: "Other" }).reason).toBe(
    "Failed with “Other”",
  );
  expect(testOutcome(failing, { result: 1 }).reason).toBe(
    "Returned 1 instead of failing",
  );
  // An expected null is a result like any other.
  expect(
    testOutcome({ expectedResult: null, expectedError: null }, { result: null })
      .passed,
  ).toBe(true);
});

test("inputs name and summarize a test", () => {
  const inputs = { amount: 3, tier: "gold", flags: [true] };
  expect(suggestedTestName(inputs)).toBe("amount 3, tier gold, flags [true]");
  expect(inputsText(inputs)).toBe('amount 3 · tier "gold" · flags [true]');
  expect(suggestedTestName({})).toBe("No inputs");
  expect(inputsText({})).toBe("No inputs");
  expect(suggestedTestName({ text: "x".repeat(200) })).toHaveLength(80);
});

test("counts say how many tests passed, failed or have not run", () => {
  const tests = [1, 2, 3].map((id) => ({ id }) as TestCase);
  expect(
    resultCounts(tests, {
      1: { passed: true, reason: null, run: { result: 1 } },
      2: { passed: false, reason: "x", run: { error: "x" } },
    }),
  ).toEqual({ passed: 1, failed: 1, pending: 1 });
});
