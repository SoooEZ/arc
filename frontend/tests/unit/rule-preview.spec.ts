import { expect, test } from "@playwright/test";
import {
  previewNodeHeight,
  previewNodeWidth,
  rulePreview,
} from "../../src/features/library/previewLayout";
import type { Definition, RuleNode } from "../../src/types";

const node = (id: string): RuleNode => ({
  id,
  type: "FORMULA",
  label: id,
  position: { x: 0, y: 0 },
});
function branching(): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      "input",
      "left",
      "right",
      "join",
      "cycle-a",
      "cycle-b",
      "alone",
    ].map(node),
    edges: [
      ["input", "left"],
      ["input", "right"],
      ["left", "join"],
      ["right", "join"],
      ["cycle-a", "cycle-b"],
      ["cycle-b", "cycle-a"],
    ].map(([source, target], i) => ({
      id: String(i),
      source,
      target,
      sourceHandle: "next",
    })),
  };
}

test("overview preserves fan-out, joins, disconnected nodes and cycles without overlap or crop", () => {
  const definition = branching();
  const graph = rulePreview(definition);
  expect(graph.nodes.map(({ node }) => node.id).sort()).toEqual(
    definition.nodes.map((node) => node.id).sort(),
  );
  expect(graph.connections.map(({ edge }) => edge)).toEqual(definition.edges);
  for (const current of graph.nodes) {
    expect(current.x).toBeGreaterThanOrEqual(0);
    expect(current.y).toBeGreaterThanOrEqual(0);
    expect(current.x + previewNodeWidth).toBeLessThanOrEqual(graph.width);
    expect(current.y + previewNodeHeight).toBeLessThanOrEqual(graph.height);
    for (const other of graph.nodes) {
      if (current === other) continue;
      expect(
        Math.abs(current.x - other.x) >= previewNodeWidth ||
          Math.abs(current.y - other.y) >= previewNodeHeight,
      ).toBe(true);
    }
  }
  expect(graph.nodes.find(({ node }) => node.id === "join")!.y).toBeGreaterThan(
    graph.nodes.find(({ node }) => node.id === "left")!.y,
  );
});

test("invalid endpoints are explicitly counted while valid graph content remains visible", () => {
  const graph = rulePreview({
    schemaVersion: 1,
    inputs: [],
    nodes: [node("start")],
    edges: [
      {
        id: "missing",
        source: "start",
        target: "missing",
        sourceHandle: "next",
      },
    ],
  });
  expect(graph.nodes).toHaveLength(1);
  expect(graph.connections).toHaveLength(0);
  expect(graph.missingConnections).toBe(1);
});

test("left to right, the overview draws layers as columns and connections from right edges", () => {
  const definition = branching();
  const graph = rulePreview(definition, "horizontal");
  const at = new Map(graph.nodes.map((placed) => [placed.node.id, placed]));
  for (const current of graph.nodes) {
    expect(current.x).toBeGreaterThanOrEqual(0);
    expect(current.y).toBeGreaterThanOrEqual(0);
    expect(current.x + previewNodeWidth).toBeLessThanOrEqual(graph.width);
    expect(current.y + previewNodeHeight).toBeLessThanOrEqual(graph.height);
    for (const other of graph.nodes) {
      if (current === other) continue;
      expect(
        Math.abs(current.x - other.x) >= previewNodeWidth ||
          Math.abs(current.y - other.y) >= previewNodeHeight,
      ).toBe(true);
    }
  }
  expect(at.get("join")!.x).toBeGreaterThan(at.get("left")!.x);
  expect(at.get("left")!.x).toBe(at.get("right")!.x);
  for (const { edge, sx } of graph.connections)
    expect(sx).toBe(at.get(edge.source)!.x + previewNodeWidth);
  // Top to bottom is unchanged by the new parameter.
  expect(rulePreview(definition, "vertical")).toEqual(rulePreview(definition));
});
