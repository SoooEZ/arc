import { expect, test } from "@playwright/test";
import type { DataSource } from "../../src/types";
import {
  MAX_SECRET_HEADERS,
  secretHeadersProblem,
} from "../../src/features/sources/httpSourcePolicy";
import {
  openSource,
  secretHeadersBufferProblem,
  sourceDocumentReducer,
  sourceSaveProblem,
} from "../../src/features/sources/sourceDocument";

const rule = "Secret headers map header names to uppercase environment aliases";

// HttpDestinationPolicy: a header name of letters, digits and hyphens that is
// not a connection header, an upper-case alias, and at most ten of them.
test("secret headers follow the server's names, aliases and count", () => {
  expect(secretHeadersProblem({ Authorization: "CRM_TOKEN" })).toBeNull();
  expect(secretHeadersProblem({ "X-Api-Key": "K2" })).toBeNull();
  const refused: Record<string, string>[] = [
    { Authorization: "crm_token" },
    { Authorization: "" },
    { Authorization: "2FA" },
    { "X Api": "TOKEN" },
    { "-Leading": "TOKEN" },
    { Host: "TOKEN" },
    { "content-length": "TOKEN" },
    { "Transfer-Encoding": "TOKEN" },
  ];
  for (const headers of refused)
    expect(secretHeadersProblem(headers), JSON.stringify(headers)).toBe(rule);
  const many = Object.fromEntries(
    Array.from({ length: MAX_SECRET_HEADERS + 1 }, (_, index) => [
      `X-Secret-${index}`,
      "TOKEN",
    ]),
  );
  expect(secretHeadersProblem(many)).toBe(
    `At most ${MAX_SECRET_HEADERS} secret headers`,
  );
});

test("an HTTP source saves only usable secret headers; a lookup ignores the HTTP text", () => {
  expect(secretHeadersBufferProblem("[]")).toBe(
    "Secret header aliases must be a JSON object.",
  );
  expect(secretHeadersBufferProblem('{"Authorization":5}')).toMatch(
    /must be text/,
  );
  expect(secretHeadersBufferProblem('{"Authorization":"CRM_TOKEN"}')).toBe(
    null,
  );
  const http: DataSource = {
    id: "customer",
    name: "Customer",
    version: 1,
    definition: {
      kind: "HTTP",
      url: "https://example.com/customer",
      parameters: [
        { name: "id", type: "STRING", required: true, defaultValue: null },
      ],
      secretHeaders: {},
      timeoutMs: 3000,
    },
  };
  const edited = (source: DataSource, value: string) =>
    sourceDocumentReducer(openSource(source, 1), {
      type: "buffer",
      field: "secretHeaders",
      value,
    })!;
  expect(sourceSaveProblem(edited(http, '{"Host":"TOKEN"}'))).toBe(rule);
  expect(sourceSaveProblem(edited(http, '{"Authorization":"TOKEN"}'))).toBe(
    null,
  );
  // Text typed for the HTTP provider waits while a lookup is saved (lesson F7).
  const lookup: DataSource = {
    ...http,
    definition: {
      kind: "LOOKUP",
      parameters: [
        { name: "key", type: "STRING", required: true, defaultValue: null },
      ],
      entries: { US: 1 },
      timeoutMs: 3000,
    },
  };
  expect(sourceSaveProblem(edited(lookup, "{unfinished"))).toBeNull();
});
