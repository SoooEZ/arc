import { expect, test } from "@playwright/test";
import {
  inputDefaultProblem,
  valueBoundProblems,
} from "../../src/domain/inputDefaults";
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

test("JSON defaults are refused at the server's value bounds, in the server's words", () => {
  // The field accepted these, and Save answered 422 from ValueBounds.
  expect(
    inputDefaultProblem(
      "ARRAY",
      Array.from({ length: 1000 }, () => 1),
    ),
  ).toBeNull();
  expect(
    inputDefaultProblem(
      "ARRAY",
      Array.from({ length: 1001 }, () => 1),
    ),
  ).toBe(valueBoundProblems.array);
  const wide = Object.fromEntries(
    Array.from({ length: 1001 }, (_, index) => [`f${index}`, 1]),
  );
  expect(inputDefaultProblem("OBJECT", wide)).toBe(valueBoundProblems.object);
  expect(inputDefaultProblem("OBJECT", { text: "t".repeat(2000) })).toBeNull();
  expect(inputDefaultProblem("OBJECT", { text: "t".repeat(2001) })).toBe(
    valueBoundProblems.string,
  );
  // A key is a value too: the server bounds keys before their values.
  expect(inputDefaultProblem("OBJECT", { ["k".repeat(2001)]: 1 })).toBe(
    valueBoundProblems.string,
  );
  // Eight levels below the root pass; a ninth does not.
  let nested: unknown = 1;
  for (let level = 0; level < 8; level++) nested = [nested];
  expect(inputDefaultProblem("ARRAY", nested as unknown[])).toBeNull();
  expect(inputDefaultProblem("ARRAY", [nested])).toBe(
    valueBoundProblems.sizeOrDepth,
  );
  // 10,000 elements in all, the root and every key counted.
  const rows = Array.from({ length: 11 }, () =>
    Array.from({ length: 1000 }, () => 0),
  );
  expect(inputDefaultProblem("ARRAY", rows)).toBe(
    valueBoundProblems.sizeOrDepth,
  );
  expect(
    inputDefaultProblem(
      "ARRAY",
      Array.from({ length: 9 }, () => Array.from({ length: 1000 }, () => 0)),
    ),
  ).toBeNull();
});

test("a very large pasted default is refused without exhausting the call stack", () => {
  // pending.push(...current) threw RangeError for about 125,000 items, leaving the field unchecked.
  const huge = Array.from({ length: 200_000 }, (_, index) => index);
  expect(inputDefaultProblem("ARRAY", huge)).toBe(valueBoundProblems.array);
  expect(inputDefaultProblem("OBJECT", { huge })).toBe(
    valueBoundProblems.array,
  );
});
