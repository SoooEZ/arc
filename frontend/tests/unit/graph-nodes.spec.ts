import { expect, test } from "@playwright/test";
import {
  canRemoveGraphNode,
  createGraphNode,
  newInputParameter,
  removeGraphNode,
} from "../../src/domain/graph";
import { nodeKinds, storesResult } from "../../src/domain/nodeKinds";
import type { Definition, NodeType } from "../../src/types";

function template(): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "calculate",
        type: "FORMULA",
        label: "Calculate",
        position: { x: 0, y: 200 },
        expression: "amount * 0.9",
        output: "total",
      },
      {
        id: "result",
        type: "OUTPUT",
        label: "Return",
        position: { x: 0, y: 400 },
        expression: "total",
      },
    ],
    edges: [],
  };
}

function addNode(definition: Definition, type: NodeType, id: string) {
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      createGraphNode(definition, type, id, { x: 0, y: 0 }),
    ],
  };
}

function resultNames(definition: Definition) {
  return definition.nodes.flatMap((node) => (node.output ? [node.output] : []));
}

test("new result nodes never reuse a variable name after deletions", () => {
  let definition = addNode(template(), "FORMULA", "first");
  definition = addNode(definition, "FORMULA", "second");
  definition = removeGraphNode(definition, "first");
  definition = addNode(definition, "FORMULA", "third");
  definition = removeGraphNode(definition, "result");
  definition = addNode(definition, "TRANSFORM", "shape");
  definition = addNode(definition, "REFERENCE", "reuse");
  const names = resultNames(definition);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual([
    "total",
    "result_2",
    "result_1",
    "result_3",
    "result_4",
  ]);
});

test("generated result names also avoid input parameter names", () => {
  const definition = template();
  definition.inputs.push({
    name: "result_1",
    type: "NUMBER",
    required: false,
    defaultValue: null,
  });
  expect(
    createGraphNode(definition, "FORMULA", "new", { x: 0, y: 0 }).output,
  ).toBe("result_2");
  for (const type of ["INPUT", "CONDITION", "SWITCH", "OUTPUT"] as const)
    expect(
      createGraphNode(definition, type, "new", { x: 0, y: 0 }).output,
      type,
    ).toBeUndefined();
});

test("result-producing kinds and removable nodes follow the graph contract", () => {
  expect(
    (
      [
        "INPUT",
        "FORMULA",
        "CONDITION",
        "SWITCH",
        "TRANSFORM",
        "REFERENCE",
        "OUTPUT",
      ] as const
    ).filter(storesResult),
  ).toEqual(["FORMULA", "TRANSFORM", "REFERENCE"]);
  const definition = template();
  expect(canRemoveGraphNode(definition, "calculate")).toBe(true);
  expect(canRemoveGraphNode(definition, "input")).toBe(false);
  expect(canRemoveGraphNode(definition, "missing")).toBe(false);
  expect(removeGraphNode(definition, "missing")).toBe(definition);
  // Only the entry Input (the first in document order) stays; a stray second one can go.
  const twoInputs: Definition = {
    ...definition,
    nodes: [
      ...definition.nodes,
      { id: "input2", type: "INPUT", label: "Stray", position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: "e", source: "input2", target: "result", sourceHandle: "next" },
    ],
  };
  expect(nodeKinds.INPUT.removable).toBe("extra");
  expect(canRemoveGraphNode(twoInputs, "input2")).toBe(true);
  expect(canRemoveGraphNode(twoInputs, "input")).toBe(false);
  expect(removeGraphNode(twoInputs, "input2")).toEqual({
    ...twoInputs,
    nodes: definition.nodes,
    edges: [],
  });
  const lastNode = { ...definition, nodes: [definition.nodes[2]] };
  expect(canRemoveGraphNode(lastNode, "result")).toBe(false);
  expect(removeGraphNode(lastNode, "result")).toBe(lastNode);
});

test("a new input parameter never takes a node result's name", () => {
  const definition = template();
  definition.nodes[1] = { ...definition.nodes[1], output: "input2" };
  // Add parameter named it input2, and Calculate failed with "cannot overwrite input input2".
  expect(newInputParameter(definition).name).toBe("input3");
  let current = definition;
  for (let step = 0; step < 5; step++) {
    const added = newInputParameter(current);
    expect([
      ...current.inputs.map((input) => input.name),
      ...resultNames(current),
    ]).not.toContain(added.name);
    current = { ...current, inputs: [...current.inputs, added] };
  }
});
