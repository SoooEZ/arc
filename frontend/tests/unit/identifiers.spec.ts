import { expect, test } from "@playwright/test";
import {
  acceptsParameterNameEdit,
  parameterNameError,
} from "../../src/domain/identifiers";
import {
  createSourceDraft,
  sourceBuffers,
  sourceCandidate,
  sourceParameterBufferError,
} from "../../src/features/sources/model";

test("parameter editing permits keyword prefixes and clearing, but rejects invalid syntax intact", () => {
  for (const name of ["", "a", "_", "true", "trueValue", "SUM", "a".repeat(64)])
    expect(acceptsParameterNameEdit(name), name).toBe(true);
  for (const name of [
    "first name",
    "first\tname",
    "first\nname",
    "first\u00a0name",
    "$amount",
    "amount$",
    "1amount",
    "a-b",
    "a".repeat(65),
  ])
    expect(acceptsParameterNameEdit(name), name).toBe(false);
  for (const name of ["", "true", "FALSE", "Null", "and", "OR"])
    expect(parameterNameError(name), name).not.toBeNull();
  for (const name of ["SUM", "trueValue", "amount_1", "_amount"])
    expect(parameterNameError(name), name).toBeNull();
});

test("source declaration validation rejects invalid names without changing raw buffers or defaults", () => {
  const source = createSourceDraft();
  const buffers = sourceBuffers(source.definition);
  for (const name of [
    "account name",
    "account$name",
    "$account",
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
    expect(sourceParameterBufferError(raw), name).toContain("Parameter 1:");
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
  expect(sourceParameterBufferError(valid.parameters)).toBeNull();
  expect(sourceCandidate(source, valid).definition.parameters).toEqual(
    parameters,
  );
  expect(sourceParameterBufferError("[unfinished")).toContain("valid JSON");
  expect(sourceParameterBufferError("null")).toContain("JSON array");
});
