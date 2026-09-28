import { test, expect } from "@playwright/test";
import type { Definition, Execution, RuleNode } from "../../src/types";
import { patchGraphNode } from "../../src/domain/graph";
import {
  cardBounds,
  flowEdges,
  flowNodes,
  takenBranches,
  type FlowNodeInputs,
} from "../../src/features/editor/canvas/flowElements";
import { nodeSummary } from "../../src/domain/nodeKinds";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [{ name: "amount", type: "NUMBER", required: true, defaultValue: 1 }],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Large?",
      expression: "amount > 10",
      position: { x: 0, y: 150 },
    },
    {
      id: "constructor",
      type: "OUTPUT",
      label: "Yes",
      expression: "1",
      position: { x: -150, y: 300 },
    },
    {
      id: "toString",
      type: "OUTPUT",
      label: "No",
      expression: "0",
      position: { x: 150, y: 300 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "check", sourceHandle: "next" },
    { id: "b", source: "check", target: "constructor", sourceHandle: "true" },
    { id: "c", source: "check", target: "toString", sourceHandle: "false" },
  ],
};
const onExpression = () => {};
const inputs = (overrides: Partial<FlowNodeInputs> = {}): FlowNodeInputs => ({
  selected: "check",
  visited: new Set(),
  inputCount: 1,
  errors: new Map(),
  sizes: new Map(),
  onExpression,
  ...overrides,
});
const byId = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, item]));

test("editing one card rebuilds only that card's React Flow node", () => {
  const first = flowNodes(definition.nodes, inputs(), new Map());
  const edited = patchGraphNode(definition, "check", { label: "Larger?" });
  const second = flowNodes(edited.nodes, inputs(), byId(first));
  expect(second.map((node, index) => node === first[index])).toEqual([
    true,
    false,
    true,
    true,
  ]);
  expect(second[1].data.model.label).toBe("Larger?");
  const selectedElsewhere = flowNodes(
    edited.nodes,
    inputs({ selected: "input" }),
    byId(second),
  );
  expect(
    selectedElsewhere.map((node, index) => node === second[index]),
  ).toEqual([false, false, true, true]);
});

test("node data follows errors, measurements and trace changes by node ID, including prototype names", () => {
  const first = flowNodes(definition.nodes, inputs(), new Map());
  expect(first[2].data.errors).toEqual([]);
  expect(first[3].measured).toBeUndefined();
  const errors = new Map([["constructor", ["Missing value"]]]);
  const sizes = new Map([["toString", { width: 230, height: 120 }]]);
  const second = flowNodes(
    definition.nodes,
    inputs({ errors, sizes, visited: new Set(["input"]) }),
    byId(first),
  );
  expect(second[0].data.visited).toBe(true);
  expect(second[1]).toBe(first[1]);
  expect(second[2].data.errors).toEqual(["Missing value"]);
  expect(second[3].measured).toEqual({ width: 230, height: 120 });
});

test("edges keep their objects until their selection, label or traced branch changes", () => {
  const first = flowEdges(
    definition,
    { selectedEdge: null, taken: new Set() },
    new Map(),
  );
  expect(first.map((edge) => edge.label)).toEqual([undefined, "True", "False"]);
  const relabeled = patchGraphNode(definition, "constructor", {
    label: "Accepted",
  });
  const second = flowEdges(
    relabeled,
    { selectedEdge: null, taken: new Set() },
    byId(first),
  );
  expect(second.every((edge, index) => edge === first[index])).toBe(true);
  const trace: Execution = {
    ruleId: "preview",
    version: null,
    result: 1,
    durationMicros: 1,
    trace: [
      {
        ruleId: "preview",
        version: null,
        nodeId: "check",
        label: "Large?",
        type: "CONDITION",
        value: true,
        branch: "true",
        depth: 0,
      },
    ],
  };
  const traced = flowEdges(
    relabeled,
    { selectedEdge: "a", taken: takenBranches(trace) },
    byId(second),
  );
  expect(traced.map((edge, index) => edge === second[index])).toEqual([
    false,
    false,
    true,
  ]);
  expect(traced[0].selected).toBe(true);
  expect(traced[1].animated).toBe(true);
});

test("routing obstacles depend on positions and sizes only", () => {
  const sizes = new Map([["constructor", { width: 240, height: 90 }]]);
  const bounds = cardBounds(definition.nodes, sizes);
  expect(bounds[2]).toEqual({
    id: "constructor",
    x: -150,
    y: 300,
    width: 240,
    height: 90,
  });
  expect(bounds[3]).toMatchObject({ id: "toString", width: 230, height: 105 });
  const relabeled = patchGraphNode(definition, "check", { label: "Other" });
  expect(JSON.stringify(cardBounds(relabeled.nodes, sizes))).toBe(
    JSON.stringify(bounds),
  );
  const moved = patchGraphNode(definition, "check", {
    position: { x: 10, y: 150 },
  });
  expect(JSON.stringify(cardBounds(moved.nodes, sizes))).not.toBe(
    JSON.stringify(bounds),
  );
});

test("every node kind has a card summary", () => {
  const node = (patch: Partial<RuleNode>): RuleNode => ({
    id: "n",
    type: "FORMULA",
    label: "Node",
    position: { x: 0, y: 0 },
    ...patch,
  });
  expect(nodeSummary(node({ type: "INPUT" }), 1)).toBe("1 input parameter");
  expect(nodeSummary(node({ type: "INPUT" }), 2)).toBe("2 input parameters");
  expect(nodeSummary(node({ type: "REFERENCE" }), 0)).toBe("Select a rule");
  expect(
    nodeSummary(node({ type: "REFERENCE", ruleId: "tax", version: 3 }), 0),
  ).toBe("tax · v3");
  const cases = [{ id: "c", label: "C", expression: "true" }];
  expect(nodeSummary(node({ type: "SWITCH", cases }), 0)).toBe(
    "1 cases · first match + default",
  );
  expect(
    nodeSummary(node({ type: "SWITCH", cases, selector: "tier" }), 0),
  ).toBe("Match tier · 1 cases + default");
  expect(
    nodeSummary(
      node({
        type: "TRANSFORM",
        fields: [{ name: "a", expression: "1" }],
        output: "row",
      }),
      0,
    ),
  ).toBe("1 fields → row");
  expect(nodeSummary(node({ type: "TRANSFORM", expression: "x" }), 0)).toBe(
    "x",
  );
  expect(nodeSummary(node({ type: "OUTPUT", outputName: "total" }), 0)).toBe(
    "total ← Choose a value",
  );
  expect(nodeSummary(node({ type: "OUTPUT", expression: "1" }), 0)).toBe("1");
  expect(nodeSummary(node({ type: "CONDITION" }), 0)).toBe("Add an expression");
  expect(nodeSummary(node({ expression: "amount * 2" }), 0)).toBe("amount * 2");
});
