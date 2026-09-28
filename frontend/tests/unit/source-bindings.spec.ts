import { expect, test } from "@playwright/test";
import type { SourceBinding } from "../../src/types";
import { withSourceParameterBinding } from "../../src/features/sources/sourceBindings";
import { ownValue } from "../../src/domain/records";

const binding: SourceBinding = {
  id: "rates",
  version: 1,
  bindings: { key: "country" },
  pointer: "",
  onError: "FAIL",
};

test("source parameter mappings named like Object members stay own entries", () => {
  let next = binding;
  for (const name of ["constructor", "toString", "__proto__"]) {
    expect(ownValue(next.bindings, name)).toBeUndefined();
    next = withSourceParameterBinding(next, name, `value_${name.length}`);
    expect(Object.hasOwn(next.bindings, name)).toBe(true);
    expect(ownValue(next.bindings, name)).toBe(`value_${name.length}`);
  }
  expect(Object.getPrototypeOf(next.bindings)).toBe(Object.prototype);
  expect(JSON.parse(JSON.stringify(next.bindings))).toEqual({
    key: "country",
    constructor: "value_11",
    toString: "value_8",
    ["__proto__"]: "value_9",
  });
  const removed = withSourceParameterBinding(next, "__proto__", undefined);
  expect(Object.hasOwn(removed.bindings, "__proto__")).toBe(false);
  expect(removed.bindings).toEqual({
    key: "country",
    constructor: "value_11",
    toString: "value_8",
  });
  // Mappings are immutable graph data.
  expect(binding.bindings).toEqual({ key: "country" });
});
