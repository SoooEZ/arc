import { test, expect } from "@playwright/test";
import type { Definition } from "../../src/types";
import { patchGraphNode, removeGraphNode } from "../../src/domain/graph";
import {
  defaultSelection,
  selectedEdgeId,
  selectedNode,
} from "../../src/features/editor/nodeSelection";
import { exampleRule } from "./document-fixtures";

test("the selection falls back to the default node when a loaded version or build removes the selected node", () => {
  const current = exampleRule().draft;
  const version: Definition = {
    ...current,
    nodes: current.nodes.filter((node) => node.id !== "right"),
  };
  expect(selectedNode(current, "right").id).toBe("right");
  expect(selectedNode(version, "right").id).toBe("input");
  const withCondition = patchGraphNode(version, "output", {
    type: "CONDITION",
  });
  expect(selectedNode(withCondition, "right").id).toBe("output");
  // A Condition with cases (a stored SWITCH) is the same node to the editor.
  const withCases = patchGraphNode(version, "output", { type: "SWITCH" });
  expect(selectedNode(withCases, "right").id).toBe("output");
});

test("the selected connection is derived from the current draft", () => {
  const draft = exampleRule().draft;
  expect(selectedEdgeId(draft, "a")).toBe("a");
  expect(selectedEdgeId(draft, null)).toBeNull();
  // A node deletion, a build or a version load can remove the selected edge.
  expect(selectedEdgeId(removeGraphNode(draft, "left"), "a")).toBeNull();
  expect(selectedEdgeId(draft, "missing")).toBeNull();
});

test("the selected node falls back to the default node once its node is removed", () => {
  const draft: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "In", position: { x: 0, y: 0 } },
      {
        id: "check",
        type: "CONDITION",
        label: "Check",
        expression: "true",
        position: { x: 0, y: 100 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Out",
        expression: "1",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [],
  };
  expect(selectedNode(draft, "out").id).toBe("out");
  const without = {
    ...draft,
    nodes: draft.nodes.filter((n) => n.id !== "out"),
  };
  // Not the Input first: the same default a build or a version load selects.
  expect(selectedNode(without, "out")).toBe(defaultSelection(without));
  expect(selectedNode(without, "out").id).toBe("check");
});
