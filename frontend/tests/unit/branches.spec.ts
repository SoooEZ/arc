import { expect, test } from "@playwright/test";
import {
  createGraphNode,
  patchGraphNode,
  connectGraphNodes,
} from "../../src/domain/graph";
import { nodeWidth, sourcePorts } from "../../src/domain/nodePorts";
import type { Definition } from "../../src/types";

test("case edits preserve stable connections and removing a case only removes its edges", () => {
  const choose = createGraphNode("SWITCH", "choose", { x: 0, y: 0 }, 1);
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [choose, createGraphNode("OUTPUT", "out", { x: 0, y: 200 }, 2)],
    edges: ["case:case-1", "case:case-2", "default"].map((handle) => ({
      id: handle,
      source: "choose",
      target: "out",
      sourceHandle: handle,
    })),
  };
  const changed = patchGraphNode(definition, "choose", {
    cases: choose
      .cases!.toReversed()
      .map((option) => ({ ...option, label: "Renamed" })),
  });
  expect(changed.edges).toEqual(definition.edges);
  expect(sourcePorts(changed.nodes[0]).map((port) => port.id)).toEqual([
    "case:case-2",
    "case:case-1",
    "default",
  ]);
  expect(nodeWidth(changed.nodes[0])).toBe(270);
  const removed = patchGraphNode(changed, "choose", {
    cases: changed.nodes[0].cases!.slice(1),
  });
  expect(removed.edges.map((edge) => edge.sourceHandle)).toEqual([
    "case:case-1",
    "default",
  ]);
  expect(
    connectGraphNodes(removed, "choose", "out", "case:case-2", "bad"),
  ).toBe(removed);
  expect(connectGraphNodes(removed, "out", "choose", "next", "bad")).toBe(
    removed,
  );
});
