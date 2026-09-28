import { expect, test } from "@playwright/test";
import { DecimalNumber, stringifyJson } from "../../src/domain/json";
import {
  parseNumericDefault,
  sameNumericDefault,
} from "../../src/domain/numericDefaults";
import { decimalTexts } from "./decimal-texts";

test("numeric defaults retain values across decimal and JSON notation", () => {
  for (const [text, value] of [
    ["", null],
    ["  ", null],
    ["0.1", 0.1],
    ["+001.23", 1.23],
    [".5", 0.5],
    ["5.", 5],
    ["1.25e+3", 1250],
    // A zero whose exponent leaves no decimal places is the double 0 and saves as the token 0.
    ["-0.00e1000000", -0],
    ["0e5", 0],
    ["9007199254740992", 9007199254740992],
    ["100000000000000000000", 1e20],
    ["1e-7", 1e-7],
    ["1e99", 1e99],
    ["1.5e99", 1.5e99],
    ["1e-100", 1e-100],
    // Within the server's limits by value, like its Expressions.bound: stored
    // drafts write 1e100 out as 101 digits, which still passes on the next save.
    ["1e100", 1e100],
    ["1.5e100", 1.5e100],
    ["1".padEnd(101, "0"), 1e100],
  ] as const)
    expect(parseNumericDefault(text), text).toEqual({ valid: true, value });
});

test("numeric defaults keep every digit of values a double would round or rescale", () => {
  for (const [text, token] of [
    ["9007199254740993", "9007199254740993"],
    // The server keeps decimal places, so 2.50 must not reach it as 2.5.
    ["2.50", "2.50"],
    ["1.0", "1.0"],
    ["+001.2300", "1.2300"],
    [".50", "0.50"],
    ["1.2500e+3", "1.2500e3"],
    ["0.000", "0.000"],
    ["-9007199254740993", "-9007199254740993"],
    ["100000000000000000001", "100000000000000000001"],
    ["0.10000000000000001", "0.10000000000000001"],
    ["1.23456789012345678", "1.23456789012345678"],
    // Typed spelling becomes a JSON number token with the same digits.
    ["+009007199254740993", "9007199254740993"],
    ["-.10000000000000000000001", "-0.10000000000000000000001"],
    ["9007199254740993.", "9007199254740993"],
    ["1.00000000000000000001E+5", "1.00000000000000000001e5"],
    ["9".repeat(100), "9".repeat(100)],
  ] as const) {
    const parsed = parseNumericDefault(text);
    expect(parsed, text).toEqual({
      valid: true,
      value: new DecimalNumber(token),
    });
    // The saved request writes the token itself, never a rounded double.
    if (parsed.valid)
      expect(stringifyJson({ defaultValue: parsed.value })).toBe(
        `{"defaultValue":${token}}`,
      );
  }
});

test("numeric defaults reject values the server cannot store and incomplete input", () => {
  const unsupported = parseNumericDefault("1e400");
  expect(unsupported).toMatchObject({ valid: false });
  if (!unsupported.valid) expect(unsupported.error).toContain("100 digits");
  for (const text of [
    // Even without trailing zeros, these exceed 100 digits or a scale of 100.
    "1e400",
    "-1e400",
    "1e-400",
    "1e309",
    "1.7976931348623159e308",
    "1.7976931348623157e308",
    "5e-324",
    "1e101",
    "1".padEnd(102, "0"),
    `0.${"0".repeat(100)}1`,
    // A zero keeps its written decimal places, which the server bounds like any other number.
    "0e-101",
    `0.${"0".repeat(101)}`,
    "1.25e-99",
    `${"1".repeat(51)}.${"1".repeat(50)}`,
  ])
    expect(parseNumericDefault(text), text).toMatchObject({ valid: false });
  for (const text of [
    "1e",
    "-",
    ".",
    "e3",
    "1.2.3",
    "0x10",
    "NaN",
    "Infinity",
    "1 000",
  ])
    expect(parseNumericDefault(text), text).toEqual({
      valid: false,
      error: "Enter a valid number before saving",
    });
});

test("numeric default identity compares decimal values, not spelling or instances", () => {
  const exact = new DecimalNumber("9007199254740993");
  for (const [left, right] of [
    [null, null],
    [null, undefined],
    [0.5, 0.5],
    [-0, 0],
    [exact, new DecimalNumber("9007199254740993")],
    [
      new DecimalNumber("1.00000000000000000001e5"),
      new DecimalNumber("100000.000000000000001"),
    ],
    [new DecimalNumber("1.5"), 1.5],
  ] as const)
    expect(sameNumericDefault(left, right), `${left} ${right}`).toBe(true);
  for (const [left, right] of [
    [null, 0],
    [exact, new DecimalNumber("9007199254740992")],
    [exact, 9007199254740992],
    [1, "1"],
  ] as const)
    expect(sameNumericDefault(left, right), `${left} ${right}`).toBe(false);
});

test("numeric defaults accept exactly the texts of the shared decimal grammar", () => {
  for (const [text, accepted] of decimalTexts)
    if (text.trim())
      expect(parseNumericDefault(text).valid, text).toBe(accepted);
});
