import { expect, test } from "@playwright/test";
import type { Definition } from "../../src/types";
import { nodeVariables } from "../../src/features/editor/inspector/useNodeVariables";

const prototypeNames = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
];

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    ...prototypeNames.map((id) => ({
      id,
      type: "OUTPUT" as const,
      label: `Return ${id}`,
      expression: "amount",
      position: { x: 0, y: 160 },
    })),
  ],
  edges: prototypeNames.map((id) => ({
    id: `to-${id}`,
    source: "input",
    target: id,
    sourceHandle: "next",
  })),
};

test("inspected nodes named like Object.prototype members read only their own scope entry", () => {
  // Before /api/variables answers, the scope map is empty.
  for (const id of prototypeNames)
    expect(nodeVariables(definition, id, {}), id).toEqual([]);
  const scopes: Record<string, string[]> = JSON.parse(
    JSON.stringify(
      Object.fromEntries(prototypeNames.map((id) => [id, ["amount"]])),
    ),
  );
  for (const id of prototypeNames)
    expect(nodeVariables(definition, id, scopes), id).toEqual([
      { name: "amount", type: "NUMBER", label: "Inputs" },
    ]);
});
