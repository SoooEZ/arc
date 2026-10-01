import { expect, test } from "@playwright/test";
import {
  acceptsIdentifierEdit,
  identifierError,
} from "../../src/domain/identifiers";
import {
  createSourceDraft,
  sourceBuffers,
  sourceCandidate,
  sourceParameterBufferError,
} from "../../src/features/sources/model";

test("identifier editing permits keyword prefixes and clearing, but rejects invalid syntax intact", () => {
  for (const name of ["", "a", "_", "true", "trueValue", "SUM", "a".repeat(64)])
    expect(acceptsIdentifierEdit("", name), name).toBe(true);
  for (const name of [
    "first name",
    "first\tname",
    "first\nname",
    "first\u00a0name",
    "$amount",
    "amount$",
    "@amount",
    "amount@",
    "1amount",
    "a-b",
    "a".repeat(65),
  ])
    expect(acceptsIdentifierEdit("", name), name).toBe(false);
  for (const name of ["", "true", "FALSE", "Null", "and", "OR"])
    expect(identifierError(name), name).not.toBeNull();
  for (const name of ["SUM", "trueValue", "amount_1", "_amount"])
    expect(identifierError(name), name).toBeNull();
});

test("a stored invalid name can be shortened and repaired, but typing cannot add a violation", () => {
  for (const [previous, next] of [
    ["order-total", "order-tota"],
    ["order-total", "rder-total"],
    ["total amount", "total amoun"],
    ["a".repeat(70), "a".repeat(69)],
    ["a".repeat(70), "a".repeat(30)],
    ["1-total", "1total"],
    ["a-b-c", "a_b-c"],
    ["order-total", "order_total"],
    ["order-total", "order-totals"],
    ["a".repeat(70), "b" + "a".repeat(69)],
  ])
    expect(
      acceptsIdentifierEdit(previous, next),
      `${previous} -> ${next}`,
    ).toBe(true);
  for (const [previous, next] of [
    ["order-total", "order--total"],
    ["order-total", "order total"],
    ["order-total", "$order-total"],
    ["order-total", "order-total@"],
    ["a".repeat(70), "a".repeat(71)],
    ["x-y", "1x-y"],
    ["_1abc", "1abc"],
    ["a".repeat(64), "a".repeat(65)],
    ["amount", "amount-"],
  ])
    expect(
      acceptsIdentifierEdit(previous, next),
      `${previous} -> ${next}`,
    ).toBe(false);
});

test("source declaration validation rejects invalid names without changing raw buffers or defaults", () => {
  const source = createSourceDraft();
  const buffers = sourceBuffers(source.definition);
  for (const name of [
    "account name",
    "account$name",
    "$account",
    "account@name",
    "account\tname",
    "account\u00a0name",
    "AND",
    "",
    "1account",
    "a".repeat(65),
  ]) {
    const raw = JSON.stringify([
      {
        name,
        type: "OBJECT",
        required: false,
        defaultValue: { "display name": "$value" },
      },
    ]);
    const invalid = { ...buffers, parameters: raw };
    // Identifier rules hold for every kind; HTTP adds no rule of its own.
    expect(sourceParameterBufferError(raw, "HTTP"), name).toContain(
      "Parameter 1:",
    );
    expect(() => sourceCandidate(source, invalid), name).toThrow(
      "Parameter 1:",
    );
    expect(invalid.parameters).toBe(raw);
    expect(source.definition.parameters[0].name).toBe("key");
  }
  const parameters = [
    {
      name: "SUM",
      type: "OBJECT",
      required: false,
      defaultValue: { "display name": "$value", $field: "contains spaces" },
    },
  ];
  const valid = { ...buffers, parameters: JSON.stringify(parameters) };
  expect(sourceParameterBufferError(valid.parameters, "HTTP")).toBeNull();
  expect(sourceCandidate(source, valid).definition.parameters).toEqual(
    parameters,
  );
  expect(sourceParameterBufferError("[unfinished", "HTTP")).toContain(
    "valid JSON",
  );
  expect(sourceParameterBufferError("null", "HTTP")).toContain("JSON array");
});
