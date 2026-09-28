import { expect, test } from "@playwright/test";
import {
  acceptsVariableType,
  bindingConstantTypes,
  comparisonBindingType,
  compatibleConstantType,
  constantTextError,
  inferBindingMode,
  inferConstantType,
  withBinding,
} from "../../src/domain/valueBinding";
import { literalCases } from "./literal-cases";

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

test("literal classification accepts exactly the literals the server tokenizer reads", () => {
  for (const { text, constant, server } of literalCases) {
    expect(inferConstantType(text), JSON.stringify(text)).toBe(constant);
    // The table itself must never offer a constant the server rejects.
    if (constant !== null) expect(server, JSON.stringify(text)).toBe("literal");
    if (server === "error")
      expect(inferBindingMode(text, "ANY", []), JSON.stringify(text)).toBe(
        "expression",
      );
  }
});

test("typed constant fields name partial or rejected text without flagging an empty field", () => {
  for (const text of [".5e3", "1.", "1e", "1_000"])
    expect(constantTextError("NUMBER", text), text).toContain("number");
  for (const text of ["[1, 2,", '[{"a": 1}]', "[.5]", "1"])
    expect(constantTextError("ARRAY", text), text).toContain("array");
  for (const [type, text] of [
    ["NUMBER", "-0.5"],
    ["NUMBER", "1e3"],
    ["NUMBER", ""],
    ["ARRAY", '[1, "two", [3]]'],
    ["ARRAY", ""],
    ["STRING", "not quoted"],
    ["BOOLEAN", "maybe"],
  ] as const)
    expect(constantTextError(type, text), `${type}: ${text}`).toBeNull();
});

test("variable-shaped values follow the shared identifier policy", () => {
  expect(inferBindingMode("total_2", "ANY", [])).toBe("variable");
  expect(inferBindingMode("and", "ANY", [])).toBe("expression");
  expect(inferBindingMode("OR", "BOOLEAN", [])).toBe("expression");
  expect(inferBindingMode("a".repeat(64), "ANY", [])).toBe("variable");
  expect(inferBindingMode("a".repeat(65), "ANY", [])).toBe("expression");
  // A listed name that predates identifier validation stays a variable.
  expect(inferBindingMode("order-total", "ANY", ["order-total"])).toBe(
    "variable",
  );
  expect(inferBindingMode("order-total", "ANY", [])).toBe("expression");
});

test("parameter mappings named like Object.prototype members stay own entries in order", () => {
  const names = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ];
  let bindings = withBinding({ amount: "1" }, "rate", "2");
  for (const name of names)
    bindings = withBinding(bindings, name, name.length.toString());
  expect(Object.getPrototypeOf(bindings)).toBe(Object.prototype);
  expect(Object.keys(bindings)).toEqual(["amount", "rate", ...names]);
  expect(JSON.parse(JSON.stringify(bindings))).toEqual(
    JSON.parse(
      '{"amount":"1","rate":"2","__proto__":"9","constructor":"11","toString":"8","valueOf":"7","hasOwnProperty":"14"}',
    ),
  );
  const replaced = withBinding(bindings, "__proto__", "amount");
  expect(Object.keys(replaced)).toEqual(Object.keys(bindings));
  expect(Object.getOwnPropertyDescriptor(replaced, "__proto__")?.value).toBe(
    "amount",
  );
  const removed = withBinding(replaced, "__proto__", undefined);
  expect(Object.keys(removed)).toEqual(["amount", "rate", ...names.slice(1)]);
  expect(withBinding(removed, "missing", undefined)).toEqual(removed);
  expect(withBinding(null, "amount", undefined)).toEqual({});
  expect(bindings.amount).toBe("1");
});
