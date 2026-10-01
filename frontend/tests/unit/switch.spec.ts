import { expect, test } from "@playwright/test";
import type { BranchCase } from "../../src/types";
import { createGraphNode } from "../../src/domain/graph";
import {
  addSwitchDefaultReturn,
  switchDefaultOutput,
  withCaseChanged,
  withCaseMoved,
  withNewCase,
  withoutCase,
} from "../../src/domain/switchBranches";
import type { Definition } from "../../src/types";

const empty: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  edges: [],
};

function definition(): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      createGraphNode(empty, "SWITCH", "choose", { x: 0, y: 0 }),
      createGraphNode(empty, "OUTPUT", "match", { x: 0, y: 200 }),
    ],
    edges: [
      {
        id: "case",
        source: "choose",
        sourceHandle: "case:case-1",
        target: "match",
      },
    ],
  };
}

test("a default return adds a real Output without changing case routes and preserves falsy values", () => {
  const before = definition();
  const added = addSwitchDefaultReturn(
    before,
    "choose",
    "false",
    "fallback",
    "default-edge",
  );
  expect(before.nodes).toHaveLength(2);
  expect(added.nodes).toHaveLength(3);
  expect(added.edges).toContainEqual(before.edges[0]);
  expect(added.edges).toContainEqual({
    id: "default-edge",
    source: "choose",
    sourceHandle: "default",
    target: "fallback",
  });
  expect(switchDefaultOutput(added, "choose")?.expression).toBe("false");
  expect(switchDefaultOutput(added, "choose")!.position.x).toBeGreaterThan(270);
  // Adding again, as a repeated click's updater does, keeps the return and
  // its value: it used to write the new expression over the edited one.
  expect(addSwitchDefaultReturn(added, "choose", "0", "unused", "unused")).toBe(
    added,
  );
  expect(added.nodes.find((node) => node.id === "match")).toEqual(
    before.nodes[1],
  );
});

test("case list operations keep their order, IDs and the cases they do not touch", () => {
  const cases: BranchCase[] = [
    { id: "a", label: "A", expression: "x > 1" },
    { id: "b", label: "B", expression: "x > 2" },
  ];
  expect(withNewCase(cases, "c")).toEqual([
    ...cases,
    { id: "c", label: "Case 3", expression: "true" },
  ]);
  expect(withCaseChanged(cases, "b", { label: "Big" })[1]).toEqual({
    id: "b",
    label: "Big",
    expression: "x > 2",
  });
  expect(withoutCase(cases, "a")).toEqual([cases[1]]);
  expect(withCaseMoved(cases, "b", -1).map((option) => option.id)).toEqual([
    "b",
    "a",
  ]);
  // At either end nothing moves, so the draft does not change.
  expect(withCaseMoved(cases, "a", -1)).toBe(cases);
  expect(withCaseMoved(cases, "b", 1)).toBe(cases);
  expect(cases.map((option) => option.id)).toEqual(["a", "b"]);
});

test("default shortcuts cannot rewrite shared Outputs or connected workflow branches", () => {
  const shared = definition();
  shared.edges.push({
    id: "default-edge",
    source: "choose",
    sourceHandle: "default",
    target: "match",
  });
  expect(switchDefaultOutput(shared, "choose")).toBeUndefined();
  expect(addSwitchDefaultReturn(shared, "choose", "10", "new", "edge")).toBe(
    shared,
  );
  const downstream = definition();
  downstream.nodes.push(
    createGraphNode(downstream, "FORMULA", "formula", { x: 0, y: 400 }),
  );
  downstream.edges.push({
    id: "default-edge",
    source: "choose",
    sourceHandle: "default",
    target: "formula",
  });
  expect(
    addSwitchDefaultReturn(downstream, "choose", "10", "new", "edge"),
  ).toBe(downstream);
});

test("generated Default Output names stay valid at the node label limit", () => {
  const before = definition();
  before.nodes[0].label = "x".repeat(149) + "😀" + "y".repeat(9);
  const added = addSwitchDefaultReturn(
    before,
    "choose",
    "0",
    "fallback",
    "edge",
  );
  const label = switchDefaultOutput(added, "choose")!.label;
  expect(label.length).toBeLessThanOrEqual(160);
  expect(label.endsWith(" · Default")).toBe(true);
  expect(label.isWellFormed()).toBe(true);
  expect(before.nodes[0].label).toHaveLength(160);
});
