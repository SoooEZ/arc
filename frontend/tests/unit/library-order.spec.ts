import { expect, test } from "@playwright/test";
import { newestFirst } from "../../src/features/library/libraryOrder";
import type { RuleSummary } from "../../src/types";

const summary = (id: string, updatedAt: string): RuleSummary => ({
  id,
  name: id,
  description: "",
  kind: "FORMULA",
  revision: 1,
  publishedVersion: null,
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt,
  nodeCount: 2,
  inputCount: 0,
  referenceCount: 0,
});

// The server writes as many fraction digits as an instant has: compared as
// text, "…:00.5Z" sorted before "…:00.25Z" and "…:00Z" after both.
test("the library shows the most recently updated rule first, compared as instants", () => {
  const rules = [
    summary("whole", "2026-10-01T10:00:00Z"),
    summary("quarter", "2026-10-01T10:00:00.25Z"),
    summary("half", "2026-10-01T10:00:00.5Z"),
    summary("later", "2026-10-01T10:00:01Z"),
  ];
  expect(newestFirst(rules).map((rule) => rule.id)).toEqual([
    "later",
    "half",
    "quarter",
    "whole",
  ]);
  expect(rules[0].id).toBe("whole");
});
