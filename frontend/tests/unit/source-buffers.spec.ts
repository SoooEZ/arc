import { expect, test } from "@playwright/test";
import type { DataSource } from "../../src/types";
import { parseJson, stringifyJson } from "../../src/domain/json";
import {
  parseSourceTestInputs,
  sourceBuffers,
  sourceCandidate,
  sourceSample,
} from "../../src/features/sources/model";

/** A source as the API returns it, decoded by the HTTP client's lossless codec. */
function apiSource(definition: string): DataSource {
  const source = parseJson(
    `{"id":"accounts","name":"Accounts","version":1,"definition":${definition}}`,
  );
  // The test controls the document shape; the codec only preserves its numbers.
  return source as DataSource;
}

const lookupEntries =
  '{"US":{"accountId":12345678901234567890,"rate":0.07000000000000000001,"limit":9007199254740993,"tiers":[1e400,-9007199254740993]}}';
const exactParameters =
  '[{"name":"key","type":"STRING","required":true,"defaultValue":null},{"name":"limit","type":"NUMBER","required":false,"defaultValue":9007199254740993}]';

test("unchanged source buffers save every digit of lookup entries and parameters", () => {
  const source = apiSource(
    `{"kind":"LOOKUP","parameters":${exactParameters},"entries":${lookupEntries},"timeoutMs":3000}`,
  );
  const buffers = sourceBuffers(source.definition);
  expect(buffers.entries).toContain('"accountId": 12345678901234567890');
  expect(buffers.entries).toContain('"rate": 0.07000000000000000001');
  expect(buffers.parameters).toContain('"defaultValue": 9007199254740993');

  const saved = sourceCandidate(source, buffers).definition;
  expect(stringifyJson(saved.entries)).toBe(lookupEntries);
  expect(stringifyJson(saved.parameters)).toBe(exactParameters);
});

test("source test samples and test inputs keep every digit", () => {
  const source = apiSource(
    `{"kind":"LOOKUP","parameters":${exactParameters},"entries":{},"timeoutMs":3000}`,
  );
  expect(sourceSample(source.definition)).toBe(
    '{\n  "key": "US",\n  "limit": 9007199254740993\n}',
  );
  const inputs = parseSourceTestInputs('{"key":"US","limit":9007199254740993}');
  expect(stringifyJson(inputs)).toBe('{"key":"US","limit":9007199254740993}');
  for (const text of ["null", "[]", "5", '"US"'])
    expect(() => parseSourceTestInputs(text), text).toThrow(
      new Error("Test parameters must be a JSON object."),
    );
  expect(() => parseSourceTestInputs('{"key":')).toThrow(SyntaxError);
});

test("lookup entries and secret header aliases must be JSON objects before saving", () => {
  const lookup = apiSource(
    '{"kind":"LOOKUP","parameters":[{"name":"key","type":"STRING","required":true}],"entries":{},"timeoutMs":3000}',
  );
  for (const entries of ["[]", "null", "12"])
    expect(
      () =>
        sourceCandidate(lookup, {
          ...sourceBuffers(lookup.definition),
          entries,
        }),
      entries,
    ).toThrow(new Error("Lookup entries must be a JSON object."));

  const http = apiSource(
    '{"kind":"HTTP","url":"https://example.com/customer","parameters":[{"name":"customerId","type":"STRING","required":true}],"secretHeaders":{"Authorization":"CRM_TOKEN"},"timeoutMs":3000}',
  );
  const buffers = sourceBuffers(http.definition);
  expect(sourceCandidate(http, buffers).definition.secretHeaders).toEqual({
    Authorization: "CRM_TOKEN",
  });
  for (const secretHeaders of ["[]", "null"])
    expect(
      () => sourceCandidate(http, { ...buffers, secretHeaders }),
      secretHeaders,
    ).toThrow(new Error("Secret header aliases must be a JSON object."));
  expect(() =>
    sourceCandidate(http, { ...buffers, secretHeaders: '{"Authorization":5}' }),
  ).toThrow(/Secret header aliases must be text/);
});
