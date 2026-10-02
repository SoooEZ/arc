import { expect, test } from "@playwright/test";
import type { Definition } from "../../src/types";
import { parseJson } from "../../src/domain/json";
import {
  definitionJson,
  nodeJsonOffset,
} from "../../src/features/studio/definitionJson";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "route",
      type: "SWITCH",
      label: "Route",
      selector: "amount",
      // A case may share an ID with a node; it sits deeper in the JSON.
      cases: [{ id: "out", label: "Out", expression: "1" }],
      position: { x: 0, y: 150 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 0, y: 300 },
    },
  ],
  edges: [
    { id: "gone", source: "input", target: "route", sourceHandle: "next" },
    { id: "out", source: "route", target: "out", sourceHandle: "case:out" },
  ],
};

test("the JSON is the stored form, indented by two, every digit kept", () => {
  const stored = parseJson(
    '{"schemaVersion":1,"inputs":[{"name":"rate","type":"NUMBER","required":false,"defaultValue":0.070}],"nodes":[],"edges":[]}',
  );
  const text = definitionJson(stored as Definition);
  expect(text).toContain('\n  "inputs": [\n');
  expect(text).toContain('"defaultValue": 0.070');
});

test("a node is found at its own ID, never at a case or a connection that shares it", () => {
  const text = definitionJson(definition);
  const out = nodeJsonOffset(text, "out");
  expect(out).not.toBeNull();
  const line = text.slice(out!, text.indexOf("\n", out!));
  expect(line).toBe('      "id": "out",');
  // The Output node follows the Switch whose case is also "out".
  expect(out!).toBeGreaterThan(text.indexOf('"id": "route"'));
  expect(out!).toBeLessThan(text.indexOf('\n  "edges": ['));
  // "gone" names only a connection.
  expect(nodeJsonOffset(text, "gone")).toBeNull();
  expect(nodeJsonOffset(text, "missing")).toBeNull();
});

test("a graph without nodes has no node to find", () => {
  const text = definitionJson({ ...definition, nodes: [], edges: [] });
  expect(nodeJsonOffset(text, "out")).toBeNull();
});
