import { expect, test } from "@playwright/test";
import { inputDefaultProblem } from "../../src/domain/inputDefaults";
import { DecimalNumber } from "../../src/domain/json";
import { unsupportedNumber } from "../../src/domain/numericDefaults";

const arrayProblem = "An ARRAY default must be a JSON array such as [1, 2].";
const objectProblem =
  'An OBJECT default must be a JSON object such as {"key": 1}.';

test("JSON defaults are checked like the server's type check and number limits", () => {
  // The field accepted {} for an ARRAY, and the save then failed with the server's 422.
  expect(inputDefaultProblem("ARRAY", {})).toBe(arrayProblem);
  expect(inputDefaultProblem("ARRAY", 5)).toBe(arrayProblem);
  expect(inputDefaultProblem("ARRAY", "[1]")).toBe(arrayProblem);
  expect(inputDefaultProblem("OBJECT", [])).toBe(objectProblem);
  expect(inputDefaultProblem("OBJECT", new DecimalNumber("1e400"))).toBe(
    objectProblem,
  );
  for (const value of [null, undefined, [], [1, "two", null, [3]]])
    expect(inputDefaultProblem("ARRAY", value)).toBeNull();
  expect(inputDefaultProblem("OBJECT", { a: { b: [1] } })).toBeNull();
});

test("every nested number must stay within the server's precision and scale", () => {
  const hundredDigits = "1".repeat(100);
  expect(inputDefaultProblem("ARRAY", [new DecimalNumber(hundredDigits)])).toBe(
    null,
  );
  expect(
    inputDefaultProblem("ARRAY", [[new DecimalNumber(hundredDigits + "1")]]),
  ).toBe(unsupportedNumber);
  expect(inputDefaultProblem("ARRAY", [new DecimalNumber("1e400")])).toBe(
    unsupportedNumber,
  );
  expect(inputDefaultProblem("OBJECT", { deep: { value: 1e-101 } })).toBe(
    unsupportedNumber,
  );
  // Doubles are checked as JSON writes them: 1e21 is "1e+21", a one-digit number.
  expect(inputDefaultProblem("OBJECT", { value: 1e21, other: 2.5 })).toBeNull();
  // A 101-digit integer with trailing zeros is 1e100 once stored, which the server keeps.
  expect(
    inputDefaultProblem("ARRAY", [new DecimalNumber("1" + "0".repeat(100))]),
  ).toBeNull();
});
