import { test, expect } from "@playwright/test";
import {
  readGraphFile,
  suggestedImportName,
} from "../../src/features/library/graphImport";
import { isDecimalNumber, stringifyJson } from "../../src/domain/json";

const graph = {
  schemaVersion: 1,
  inputs: [{ name: "amount", type: "NUMBER", required: true }],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs" },
    { id: "out", type: "OUTPUT", label: "Result", expression: "amount" },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

test("an exported graph reads as itself, with a count of what it holds", () => {
  const read = readGraphFile(JSON.stringify(graph));
  expect(read).toEqual({
    kind: "graph",
    definition: graph,
    summary: "2 nodes · 1 input · 1 connection",
  });
});

test("a rule's draft or a version's definition is the graph inside it", () => {
  const rule = readGraphFile(JSON.stringify({ id: "a", draft: graph }));
  const version = readGraphFile(
    JSON.stringify({ ruleId: "a", version: 2, definition: graph }),
  );
  expect(rule.kind === "graph" && rule.definition).toEqual(graph);
  expect(version.kind === "graph" && version.definition).toEqual(graph);
});

test("numbers keep every digit a double would round", () => {
  const text = JSON.stringify(graph).replace(
    '"required":true',
    '"required":true,"defaultValue":9007199254740993',
  );
  const read = readGraphFile(text);
  if (read.kind !== "graph") throw new Error(read.problem);
  const value = read.definition.inputs[0].defaultValue;
  expect(isDecimalNumber(value)).toBe(true);
  expect(stringifyJson(read.definition)).toContain(
    '"defaultValue":9007199254740993',
  );
});

test("text that is not JSON, or JSON without a graph, says why", () => {
  expect(readGraphFile("{").kind).toBe("invalid");
  const notJson = readGraphFile("not json");
  expect(notJson.kind === "invalid" && notJson.problem).toMatch(
    /^This file is not JSON: /,
  );
  for (const text of [
    "[]",
    "null",
    '{"nodes": "input"}',
    '{"nodes": [], "edges": {}}',
    '{"draft": {"edges": []}}',
  ])
    expect(readGraphFile(text)).toEqual({
      kind: "invalid",
      problem:
        "This file holds no ARC graph. Choose a file saved with Export definition.",
    });
  // Missing edges and inputs are the server's to judge: they count as none.
  const bare = readGraphFile('{"nodes": [{"id": "input"}]}');
  expect(bare.kind === "graph" && bare.summary).toBe(
    "1 node · 0 inputs · 0 connections",
  );
});

test("an exported file's name suggests the rule's name", () => {
  expect(suggestedImportName("order-pricing-v12.json")).toBe("Order pricing");
  expect(suggestedImportName("order-pricing-draft.json")).toBe("Order pricing");
  expect(suggestedImportName("Tax_rules 2026.JSON")).toBe("Tax rules 2026");
  expect(suggestedImportName(".json")).toBe("");
});
