import { expect, test } from "@playwright/test";
import type { SourceConfig } from "../../src/types";
import { parseJson } from "../../src/domain/json";
import { MAX_SOURCE_PARAMETERS } from "../../src/domain/limits";
import {
  sourceBuffers,
  sourceParameterBufferError,
} from "../../src/features/sources/sourceBuffers";
import {
  isLookupKey,
  newParameterRow,
  parameterNameProblem,
  readSourceParameters,
  sourceParameterTypes,
  withParameterType,
  writeSourceParameters,
} from "../../src/features/sources/sourceParameters";

const stored = `[{"name":"customerId","type":"STRING","required":true,"defaultValue":null,"source":null},{"name":"limit","type":"NUMBER","required":false,"defaultValue":12345678901234567890.50,"source":null}]`;

test("the table writes the parameters back as the buffer opened, every field and digit kept", () => {
  const configuration = parseJson(
    `{"kind":"HTTP","parameters":${stored},"timeoutMs":3000}`,
  ) as SourceConfig;
  const buffer = sourceBuffers(configuration).parameters;
  const read = readSourceParameters(buffer);
  expect(read.error).toBeNull();
  // An edit undone by hand leaves the text, and so the source, unchanged.
  expect(writeSourceParameters(read.rows!)).toBe(buffer);
  const edited = read.rows!.map((row, index) =>
    index === 1 ? { ...row, required: true } : row,
  );
  const text = writeSourceParameters(edited);
  expect(text).toContain('"defaultValue": 12345678901234567890.50');
  expect(text).toContain('"source": null');
  expect(readSourceParameters(text).rows![1].required).toBe(true);
});

test("only a JSON array of objects reads as table rows", () => {
  expect(readSourceParameters("[unfinished").rows).toBeNull();
  expect(readSourceParameters('{"name":"key"}')).toEqual({
    rows: null,
    error: "The parameters must be one JSON array",
  });
  expect(readSourceParameters('[{"name":"key"}, 5]')).toEqual({
    rows: null,
    error: "Every parameter must be a JSON object",
  });
  expect(readSourceParameters("[]")).toEqual({ rows: [], error: null });
});

test("new rows take a free name, and a type change keeps only a default of that type", () => {
  const first = newParameterRow([]);
  expect(first).toEqual({
    name: "parameter",
    type: "STRING",
    required: true,
    defaultValue: null,
  });
  expect(newParameterRow([first, { name: "parameter2" }]).name).toBe(
    "parameter3",
  );
  const text = { name: "region", type: "STRING", defaultValue: "EU" };
  expect(withParameterType(text, "NUMBER")).toEqual({
    name: "region",
    type: "NUMBER",
    defaultValue: null,
  });
  const decimal = parseJson('{"type":"NUMBER","defaultValue":0.10}') as Record<
    string,
    unknown
  >;
  // A number keeps its digits: the default stays the value it was read as.
  expect(withParameterType(decimal, "NUMBER").defaultValue).toBe(
    decimal.defaultValue,
  );
  expect(withParameterType(decimal, "BOOLEAN").defaultValue).toBeNull();
  // A row without a default does not gain the field.
  expect(withParameterType({ name: "flag" }, "BOOLEAN")).toEqual({
    name: "flag",
    type: "BOOLEAN",
  });
  expect(sourceParameterTypes).toEqual(["NUMBER", "STRING", "BOOLEAN"]);
});

test("a lookup's parameters are its key when they are exactly one parameter named key", () => {
  expect(isLookupKey([{ name: "key", type: "NUMBER" }])).toBe(true);
  expect(isLookupKey([{ name: "country" }])).toBe(false);
  expect(isLookupKey([{ name: "key" }, { name: "region" }])).toBe(false);
  expect(isLookupKey([])).toBe(false);
});

test("a repeated or invalid name is marked in its row and named in the list's problem", () => {
  const rows = [{ name: "customerId" }, { name: "customerId" }, { name: "$x" }];
  expect(parameterNameProblem(rows, 0)).toBe(
    "Another parameter is named customerId",
  );
  expect(parameterNameProblem(rows, 2)).toContain("Use letters, digits");
  expect(sourceParameterBufferError(JSON.stringify(rows), "HTTP")).toBe(
    "Parameter 2: another parameter is named customerId",
  );
  const tooMany = Array.from(
    { length: MAX_SOURCE_PARAMETERS + 1 },
    (_, index) => ({ name: `p${index}`, type: "STRING", required: true }),
  );
  expect(sourceParameterBufferError(JSON.stringify(tooMany), "HTTP")).toBe(
    `Provide up to ${MAX_SOURCE_PARAMETERS} source parameters`,
  );
  expect(
    sourceParameterBufferError(JSON.stringify(tooMany.slice(1)), "HTTP"),
  ).toBeNull();
});
