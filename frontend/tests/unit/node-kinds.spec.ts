import { expect, test } from "@playwright/test";
import { connectGraphNodes, createGraphNode } from "../../src/domain/graph";
import {
  addableNodeTypes,
  isNodeType,
  nodeKinds,
  nodeTypes,
} from "../../src/domain/nodeKinds";
import {
  hasTargetPort,
  nodeWidth,
  sourcePorts,
} from "../../src/domain/nodePorts";
import type { Definition, NodeType } from "../../src/types";

const empty: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  edges: [],
};
const at = { x: 1, y: 2 };

test("the descriptor covers every node kind, and only exact kind names", () => {
  expect(nodeTypes).toEqual([
    "INPUT",
    "FORMULA",
    "CONDITION",
    "SWITCH",
    "TRANSFORM",
    "REFERENCE",
    "OUTPUT",
  ]);
  for (const type of nodeTypes) expect(isNodeType(type)).toBe(true);
  // Script text can name anything; Object members must not pass for a kind.
  for (const text of ["formula", "constructor", "toString", "__proto__", ""])
    expect(isNodeType(text), text).toBe(false);
});

test("the Add node menu offers every kind but Input, in its previous order", () => {
  expect(addableNodeTypes).toEqual([
    "FORMULA",
    "CONDITION",
    "SWITCH",
    "TRANSFORM",
    "REFERENCE",
    "OUTPUT",
  ]);
});

test("labels and style keys keep the names that cards, previews and styles use", () => {
  const labels = Object.fromEntries(
    nodeTypes.map((type) => [type, nodeKinds[type].label]),
  );
  expect(labels).toEqual({
    INPUT: "Input",
    FORMULA: "Formula",
    CONDITION: "Condition",
    SWITCH: "Switch",
    TRANSFORM: "Transform",
    REFERENCE: "Reuse rule",
    OUTPUT: "Output",
  });
  // The stylesheets select node-<key>, node-icon <key> and preview-node-<key>.
  for (const type of nodeTypes)
    expect(nodeKinds[type].className).toBe(type.toLowerCase());
});

test("new nodes serialize exactly as before the descriptor", () => {
  const serialized = (type: NodeType) => {
    const node = createGraphNode(empty, type, "n", at);
    return { keys: Object.keys(node), json: JSON.stringify(node) };
  };
  const keys = [
    "id",
    "type",
    "position",
    "label",
    "expression",
    "output",
    "bindings",
    "cases",
    "fields",
  ];
  const start = '{"id":"n","type":';
  const expected: Record<NodeType, string> = {
    INPUT: `${start}"INPUT","position":{"x":1,"y":2},"label":"Input"}`,
    FORMULA: `${start}"FORMULA","position":{"x":1,"y":2},"label":"Formula","expression":"1 + 1","output":"result_1"}`,
    CONDITION: `${start}"CONDITION","position":{"x":1,"y":2},"label":"Condition","expression":"true"}`,
    SWITCH: `${start}"SWITCH","position":{"x":1,"y":2},"label":"Switch","cases":[{"id":"case-1","label":"Case 1","expression":"true"},{"id":"case-2","label":"Case 2","expression":"false"}]}`,
    TRANSFORM: `${start}"TRANSFORM","position":{"x":1,"y":2},"label":"Transform","output":"result_1","fields":[{"name":"value","expression":"null"}]}`,
    REFERENCE: `${start}"REFERENCE","position":{"x":1,"y":2},"label":"Reusable rule","output":"result_1","bindings":{}}`,
    OUTPUT: `${start}"OUTPUT","position":{"x":1,"y":2},"label":"Output","expression":"0"}`,
  };
  for (const type of nodeTypes)
    expect(serialized(type), type).toEqual({ keys, json: expected[type] });
  // Each node gets its own default collections.
  const first = createGraphNode(empty, "SWITCH", "a", at);
  const second = createGraphNode(empty, "SWITCH", "b", at);
  expect(first.cases).not.toBe(second.cases);
});

test("exits, incoming handles and card widths follow each kind", () => {
  const node = (type: NodeType) => createGraphNode(empty, type, "n", at);
  const exits = (type: NodeType) =>
    sourcePorts(node(type)).map(({ id, label, ratio, fallback }) => [
      id,
      label,
      ratio,
      fallback,
    ]);
  const next = [["next", "", 0.5, false]];
  expect(exits("INPUT")).toEqual(next);
  expect(exits("FORMULA")).toEqual(next);
  expect(exits("TRANSFORM")).toEqual(next);
  expect(exits("REFERENCE")).toEqual(next);
  expect(exits("OUTPUT")).toEqual([]);
  expect(exits("CONDITION")).toEqual([
    ["true", "True", 0.27, false],
    ["false", "False", 0.73, true],
  ]);
  expect(exits("SWITCH")).toEqual([
    ["case:case-1", "Case 1", 1 / 6, false],
    ["case:case-2", "Case 2", 0.5, false],
    ["default", "Default", 5 / 6, true],
  ]);
  for (const type of nodeTypes)
    expect(hasTargetPort(node(type)), type).toBe(type !== "INPUT");
  const widths = nodeTypes.map((type) => [type, nodeWidth(node(type))]);
  expect(widths).toEqual([
    ["INPUT", 230],
    ["FORMULA", 230],
    ["CONDITION", 230],
    ["SWITCH", 270],
    ["TRANSFORM", 230],
    ["REFERENCE", 230],
    ["OUTPUT", 230],
  ]);
  const noCases = { ...node("SWITCH"), cases: [] };
  expect(nodeWidth(noCases)).toBe(230);
  const manyCases = {
    ...noCases,
    cases: Array.from({ length: 7 }, (_, index) => ({
      id: `c${index}`,
      label: `C${index}`,
      expression: "true",
    })),
  };
  expect(nodeWidth(manyCases)).toBe(720);
});

test("nothing connects into a kind without an incoming handle", () => {
  const definition: Definition = {
    ...empty,
    nodes: [
      createGraphNode(empty, "INPUT", "input", at),
      createGraphNode(empty, "FORMULA", "formula", at),
    ],
  };
  expect(
    connectGraphNodes(definition, "formula", "input", "next", "back"),
  ).toBe(definition);
  expect(
    connectGraphNodes(definition, "input", "formula", "next", "on").edges,
  ).toEqual([
    { id: "on", source: "input", target: "formula", sourceHandle: "next" },
  ]);
  expect(
    connectGraphNodes(definition, "input", "formula", "true", "wrong"),
  ).toBe(definition);
  expect(
    connectGraphNodes(definition, "input", "missing", "next", "dangling"),
  ).toBe(definition);
});

test("only Conditions stand out on the minimap", () => {
  for (const type of nodeTypes)
    expect(nodeKinds[type].minimapColor, type).toBe(
      type === "CONDITION" ? "#e8d8b2" : "#d4dfd8",
    );
});
