import { expect, test } from "@playwright/test";
import { ownValue } from "../../src/domain/records";

test("own-value lookups ignore members inherited from Object.prototype", () => {
  const errors: Record<string, string[]> = { calc: ["Unknown variable"] };
  expect(ownValue(errors, "calc")).toEqual(["Unknown variable"]);
  for (const key of [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "missing",
  ])
    expect(ownValue(errors, key), key).toBeUndefined();
  expect(ownValue(null, "calc")).toBeUndefined();
  expect(ownValue(undefined, "calc")).toBeUndefined();
});

test("own-value lookups still return entries that use prototype names", () => {
  const scope: Record<string, string[]> = JSON.parse(
    '{"constructor":["amount"],"__proto__":["rate"],"toString":[]}',
  );
  expect(ownValue(scope, "constructor")).toEqual(["amount"]);
  expect(ownValue(scope, "__proto__")).toEqual(["rate"]);
  expect(ownValue(scope, "toString")).toEqual([]);
  const bare: Record<string, number> = Object.create(null);
  bare.valueOf = 3;
  expect(ownValue(bare, "valueOf")).toBe(3);
});
