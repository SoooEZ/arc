import { expect, test } from "@playwright/test";
import {
  previewNodeHeight,
  previewNodeWidth,
  rulePreview,
} from "../../src/domain/rulePreview";
import type { Definition, RuleNode } from "../../src/types";

const node = (id: string): RuleNode => ({
  id,
  type: "FORMULA",
  label: id,
  position: { x: 0, y: 0 },
});
test("overview preserves fan-out, joins, disconnected nodes and cycles without overlap or crop", () => {
  const definition: Definition = {
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
