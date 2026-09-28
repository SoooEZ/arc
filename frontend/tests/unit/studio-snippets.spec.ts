import { expect, test } from "@playwright/test";
import {
  escapeSnippetText,
  referenceSnippet,
  reuseNodeId,
  snippetStringLiteral,
} from "../../src/features/studio/snippets";
import type { Definition } from "../../src/types";

/** Backend DefinitionShape: node IDs match [A-Za-z0-9_-]{1,80}. */
const nodeIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  edges: [],
};

test("snippet text escaping keeps ARC code verbatim, and string literals are quoted before escaping", () => {
  expect(escapeSnippetText("$ROUND(x) } \\ ${1:a}")).toBe(
    "\\$ROUND(x) \\} \\\\ \\${1:a\\}",
  );
  expect(snippetStringLiteral('Pay $100 "now" ${1:x} \\')).toBe(
    '"Pay \\$100 \\\\"now\\\\" \\${1:x\\} \\\\\\\\"',
  );
});

test("reuse node IDs name the rule and fit the node-ID limit for the longest rule IDs", () => {
  const short = reuseNodeId("apply-discount");
  expect(short).toMatch(/^reuse-apply-discount-[0-9a-f]{4}$/);
  const longest = `r${"-a1".repeat(26)}b`;
  expect(longest).toHaveLength(80);
  for (const ruleId of [longest, longest.slice(0, 69), longest.slice(0, 70)]) {
    const nodeId = reuseNodeId(ruleId);
    expect(nodeId).toMatch(nodeIdPattern);
    expect(nodeId.startsWith(`reuse-${ruleId.slice(0, 69)}-`)).toBe(true);
  }
  expect(reuseNodeId(longest)).toHaveLength(80);
});

test("reference snippets declare the generated node ID as an escaped ARC literal", () => {
  const nodeId = reuseNodeId("x".repeat(80));
  const snippet = referenceSnippet(
    { id: "x".repeat(80), name: "Costs $5" },
    { ruleId: "x".repeat(80), version: 2, definition, publishedAt: "" },
    definition,
    nodeId,
  );
  expect(snippet).toContain(`node "${nodeId}" REFERENCE "Costs \\$5" {`);
  expect(snippet).toContain(`use "${"x".repeat(80)}" version 2;`);
});
