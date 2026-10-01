import { expect, test } from "@playwright/test";
import {
  fieldsAsObjectExpression,
  newTransformField,
} from "../../src/domain/transformFields";

test("a new Transform field takes the next free name and returns null", () => {
  expect(newTransformField([])).toEqual({
    name: "field_1",
    expression: "null",
  });
  expect(
    newTransformField([
      { name: "field_2", expression: "1" },
      { name: "total", expression: "2" },
    ]),
  ).toEqual({ name: "field_3", expression: "null" });
});

test("field mappings read as one $OBJECT expression, an empty field as null", () => {
  expect(
    fieldsAsObjectExpression([
      { name: "total", expression: "amount * 2" },
      { name: 'say "hi"', expression: "" },
    ]),
  ).toBe('$OBJECT("total", amount * 2, "say \\"hi\\"", null)');
  expect(fieldsAsObjectExpression([])).toBe("$OBJECT()");
});
