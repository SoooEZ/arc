import { expect, test } from "@playwright/test";
import {
  acceptsVariableType,
  bindingConstantTypes,
  comparisonBindingType,
  compatibleConstantType,
  inferBindingMode,
} from "../../src/domain/valueBinding";

test("typed bindings recognize compatible literals without changing their expression", () => {
  for (const [value, type] of [
    ["[1,2]", "ARRAY"],
    [' [1, "two", false, null, [3]] ', "ARRAY"],
    ["true", "BOOLEAN"],
    [" FALSE ", "BOOLEAN"],
    ["1.25e2", "NUMBER"],
    ['"a \\"quote\\" and \\\\ path"', "STRING"],
    ["'single quoted'", "STRING"],
  ] as const) {
    expect(compatibleConstantType(value, type), value).toBe(type);
    expect(inferBindingMode(value, type, []), value).toBe("constant");
  }
});

test("scalar and typed bindings keep incompatible literals in expression mode", () => {
  for (const [value, type] of [
    ["[1,2]", "SCALAR"],
    ["null", "SCALAR"],
    ["true", "NUMBER"],
    ['"2"', "NUMBER"],
    ["2", "BOOLEAN"],
    ["2", "ARRAY"],
    ["null", "ARRAY"],
    ["true", "OBJECT"],
    ["$OBJECT()", "OBJECT"],
    ["[amount]", "ARRAY"],
  ] as const) {
    expect(compatibleConstantType(value, type), `${type}: ${value}`).toBeNull();
    expect(inferBindingMode(value, type, []), `${type}: ${value}`).toBe(
      "expression",
    );
  }
  expect(bindingConstantTypes.SCALAR).toEqual(["NUMBER", "STRING", "BOOLEAN"]);
  expect(compatibleConstantType("[1,2]", "ANY")).toBe("ARRAY");
  expect(compatibleConstantType("null", "ANY")).toBe("NULL");
  expect(inferBindingMode("null", "ANY", [])).toBe("constant");
});

test("comparison controls honor declared types and infer boolean or structured literals for unknown results", () => {
  expect(comparisonBindingType("true")).toBe("BOOLEAN");
  expect(comparisonBindingType("false")).toBe("BOOLEAN");
  expect(comparisonBindingType('"ready"')).toBe("STRING");
  expect(comparisonBindingType("12")).toBe("NUMBER");
  expect(comparisonBindingType("[1,2]")).toBe("ARRAY");
  expect(comparisonBindingType("null")).toBe("ANY");
  expect(comparisonBindingType("otherResult")).toBe("ANY");
  expect(comparisonBindingType("customer.active")).toBe("ANY");
  expect(comparisonBindingType("12", "STRING")).toBe("STRING");
  expect(comparisonBindingType("null", "OBJECT")).toBe("OBJECT");
});

test("unknown variables remain selectable while expressions and function calls retain their editor", () => {
  expect(acceptsVariableType("NUMBER", "RESULT")).toBe(true);
  expect(acceptsVariableType("ARRAY", "RESULT")).toBe(true);
  expect(acceptsVariableType("SCALAR", "RESULT")).toBe(true);
  expect(acceptsVariableType("SCALAR", "BOOLEAN")).toBe(true);
  expect(acceptsVariableType("SCALAR", "ARRAY")).toBe(false);
  expect(acceptsVariableType("SCALAR", "OBJECT")).toBe(false);
  expect(acceptsVariableType("ANY", "OBJECT")).toBe(true);
  expect(acceptsVariableType("BOOLEAN", "NUMBER")).toBe(false);
  expect(acceptsVariableType("ARRAY", "ARRAY")).toBe(true);
  expect(inferBindingMode(undefined, "ARRAY", [])).toBe("variable");
  expect(inferBindingMode("items", "ARRAY", ["items"])).toBe("variable");
  expect(inferBindingMode("result", "BOOLEAN", ["result"])).toBe("variable");
  expect(inferBindingMode("disconnected", "ANY", [])).toBe("variable");
  expect(inferBindingMode("SUM", "NUMBER", ["SUM"])).toBe("variable");
  expect(inferBindingMode("$SUM(items)", "NUMBER", ["items"])).toBe(
    "expression",
  );
  expect(inferBindingMode("customer.active", "BOOLEAN", ["customer"])).toBe(
    "expression",
  );
});
