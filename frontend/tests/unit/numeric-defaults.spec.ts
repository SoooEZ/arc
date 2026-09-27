import { expect, test } from "@playwright/test";
import { parseNumericDefault } from "../../src/domain/numericDefaults";

test("numeric defaults retain values across decimal and JSON notation", () => {
  for (const [text, value] of [
    ["", null],
    ["  ", null],
    ["0.1", 0.1],
    ["+001.2300", 1.23],
    [".50", 0.5],
    ["5.", 5],
    ["1.2500e+3", 1250],
    ["-0.00e1000000", -0],
    ["9007199254740992", 9007199254740992],
    ["100000000000000000000", 1e20],
    ["1e-7", 1e-7],
    ["5e-324", 5e-324],
    ["1.7976931348623157e308", Number.MAX_VALUE],
  ] as const)
    expect(parseNumericDefault(text), text).toEqual({ valid: true, value });
});

test("numeric defaults reject rounding, overflow, underflow and incomplete input", () => {
  for (const text of [
    "9007199254740993",
    "-9007199254740993",
    "100000000000000000001",
    "0.10000000000000001",
    "1.23456789012345678",
    "1e-400",
    "1e309",
    "1.7976931348623159e308",
    "1e",
    "-",
    ".",
    "e3",
    "1.2.3",
    "0x10",
    "NaN",
    "Infinity",
  ])
    expect(parseNumericDefault(text), text).toMatchObject({ valid: false });
});
