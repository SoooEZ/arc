import { expect, test } from "@playwright/test";
import { scopeGraphKey, patchGraphNode } from "../../src/domain/graph";
import { nodeVariables } from "../../src/features/editor/inspector/useNodeVariables";
import type { Definition } from "../../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [{ name: "amount", type: "NUMBER", required: true, defaultValue: 1 }],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Price",
      expression: "amount * 2",
      output: "price",
      position: { x: 0, y: 100 },
    },
    {
      id: "choose",
      type: "SWITCH",
      label: "Choose",
      selector: "price",
      cases: [{ id: "one", label: "One", expression: "1" }],
      position: { x: 0, y: 200 },
    },
    {
      id: "shape",
      type: "TRANSFORM",
      label: "Shape",
      fields: [{ name: "a", expression: "amount" }],
      output: "shaped",
      position: { x: 0, y: 300 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "calc", sourceHandle: "next" },
    { id: "b", source: "calc", target: "choose", sourceHandle: "next" },
  ],
};

test("the scope key ignores what scope analysis does not read", () => {
  const key = scopeGraphKey(definition);
  // Every one of these edits sent /api/variables again and blanked the scope for 150 ms.
  for (const edited of [
    patchGraphNode(definition, "calc", { label: "Renamed" }),
    patchGraphNode(definition, "calc", { expression: "amount * 3" }),
    patchGraphNode(definition, "choose", {
      cases: [{ id: "one", label: "Renamed case", expression: "2" }],
    }),
    patchGraphNode(definition, "choose", { selector: "amount" }),
    patchGraphNode(definition, "shape", {
      fields: [{ name: "renamed", expression: "amount + 1" }],
    }),
    patchGraphNode(definition, "calc", { position: { x: 500, y: 500 } }),
    {
      ...definition,
      inputs: [{ ...definition.inputs[0], defaultValue: 99, required: false }],
    },
  ])
    expect(scopeGraphKey(edited)).toBe(key);
});

test("the scope key changes with inputs, node kinds, results, cases and connections", () => {
  const key = scopeGraphKey(definition);
  for (const edited of [
    { ...definition, inputs: [{ ...definition.inputs[0], name: "total" }] },
    patchGraphNode(definition, "calc", { output: "cost" }),
    patchGraphNode(definition, "choose", {
      cases: [
        { id: "one", label: "One", expression: "1" },
        { id: "two", label: "Two", expression: "2" },
      ],
    }),
    patchGraphNode(definition, "choose", { cases: [] }),
    {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "calc" ? { ...node, type: "CONDITION" as const } : node,
      ),
    },
    { ...definition, nodes: definition.nodes.slice(0, 3) },
    {
      ...definition,
      edges: [
        ...definition.edges,
        {
          id: "c",
          source: "choose",
          target: "shape",
          sourceHandle: "case:one",
        },
      ],
    },
    {
      ...definition,
      edges: [
        definition.edges[0],
        { ...definition.edges[1], sourceHandle: "true" },
      ],
    },
  ])
    expect(scopeGraphKey(edited)).not.toBe(key);
});

test("a node named like an Object.prototype member reads only its own scope (lesson F22)", () => {
  // Before the scope read answers, `{}["constructor"]` reached available.includes and threw.
  const named = {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === "choose" ? { ...node, id: "constructor" } : node,
    ),
    edges: definition.edges.map((edge) =>
      edge.target === "choose" ? { ...edge, target: "constructor" } : edge,
    ),
  };
  for (const id of ["constructor", "__proto__", "toString"])
    expect(nodeVariables(named, id, {})).toEqual([]);
  expect(
    nodeVariables(named, "constructor", {
      constructor: ["amount", "price"],
    }).map((option) => option.name),
  ).toEqual(["amount", "price"]);
});
