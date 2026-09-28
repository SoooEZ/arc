import { expect, test } from "@playwright/test";
import {
  inputTypeFacts,
  inputTypeOf,
  inputTypes,
} from "../../src/domain/inputTypes";
import type { InputType } from "../../src/types";

test("the input type descriptor lists every type once, in menu order", () => {
  const every: Record<InputType, true> = {
    NUMBER: true,
    STRING: true,
    BOOLEAN: true,
    ARRAY: true,
    OBJECT: true,
  };
  expect([...inputTypes].sort()).toEqual(Object.keys(every).sort());
  expect(new Set(inputTypes).size).toBe(inputTypes.length);
  expect(inputTypes[0]).toBe("NUMBER");
  for (const type of inputTypes)
    expect(inputTypeFacts[type].label).toBe(type.toLowerCase());
});

test("inputTypeOf reads any case and never an inherited property", () => {
  expect(inputTypeOf("NUMBER")).toBe("NUMBER");
  expect(inputTypeOf("number")).toBe("NUMBER");
  expect(inputTypeOf("Object")).toBe("OBJECT");
  expect(inputTypeOf("INTEGER")).toBeNull();
  expect(inputTypeOf("__proto__")).toBeNull();
  expect(inputTypeOf("constructor")).toBeNull();
  expect(inputTypeOf("")).toBeNull();
  expect(inputTypeOf(undefined)).toBeNull();
});
