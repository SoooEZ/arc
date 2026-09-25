import { expect, test } from "@playwright/test";
import { createGraphNode } from "../../src/domain/graph";
import {
  setSwitchDefaultReturn,
  switchDefaultOutput,
} from "../../src/domain/switchBranches";
import type { Definition } from "../../src/types";

function definition(): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      createGraphNode("SWITCH", "choose", { x: 0, y: 0 }, 1),
      createGraphNode("OUTPUT", "match", { x: 0, y: 200 }, 2),
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
  const added = setSwitchDefaultReturn(
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
  const updated = setSwitchDefaultReturn(
    added,
    "choose",
    '""',
    "unused",
    "unused",
  );
  expect(updated.nodes).toHaveLength(3);
  expect(updated.edges).toEqual(added.edges);
  expect(switchDefaultOutput(updated, "choose")?.expression).toBe('""');
  expect(updated.nodes.find((node) => node.id === "match")).toEqual(
    before.nodes[1],
  );
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
  expect(setSwitchDefaultReturn(shared, "choose", "10", "new", "edge")).toBe(
    shared,
  );
  const downstream = definition();
  downstream.nodes.push(
    createGraphNode("FORMULA", "formula", { x: 0, y: 400 }, 3),
  );
  downstream.edges.push({
    id: "default-edge",
    source: "choose",
    sourceHandle: "default",
    target: "formula",
  });
  expect(
    setSwitchDefaultReturn(downstream, "choose", "10", "new", "edge"),
  ).toBe(downstream);
});

test("generated Default Output names stay valid at the node label limit", () => {
  const before = definition();
  before.nodes[0].label = "x".repeat(149) + "😀" + "y".repeat(9);
  const added = setSwitchDefaultReturn(
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
