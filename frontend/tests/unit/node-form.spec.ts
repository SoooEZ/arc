import { expect, test } from "@playwright/test";
import type { Definition } from "../../src/types";
import { patchGraphNode } from "../../src/domain/graph";
import { applyNodeFormDraft } from "../../src/features/editor/nodeFormDraft";

const definition = (): Definition => ({
  schemaVersion: 1,
  inputs: [
    { name: "payload", type: "ARRAY", required: false, defaultValue: [] },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "branch",
      type: "SWITCH",
      label: "Branch",
      cases: [{ id: "first", label: "First", expression: "true" }],
      position: { x: 0, y: 150 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "1",
      position: { x: 0, y: 300 },
    },
  ],
  edges: [
    { id: "start", source: "input", sourceHandle: "next", target: "branch" },
    { id: "case", source: "branch", sourceHandle: "case:first", target: "out" },
  ],
});

test("node form changes preserve concurrent unrelated edits and live positions", () => {
  const before = definition();
  const edited = patchGraphNode(before, "branch", {
    label: "Edited branch",
    cases: [],
  });
  const current = {
    ...patchGraphNode(
      patchGraphNode(before, "branch", { position: { x: 500, y: 200 } }),
      "out",
      { expression: "7" },
    ),
    notes: ["Added outside the modal"],
    inputs: [
      ...before.inputs,
      {
        name: "extra",
        type: "NUMBER" as const,
        required: false,
        defaultValue: 2,
      },
    ],
  };
  const applied = applyNodeFormDraft(current, before, edited, "branch")!;
  expect(applied.nodes.find((node) => node.id === "branch")).toMatchObject({
    label: "Edited branch",
    position: { x: 500, y: 200 },
    cases: [],
  });
  expect(applied.nodes.find((node) => node.id === "out")?.expression).toBe("7");
  expect(applied.notes).toEqual(current.notes);
  expect(applied.inputs).toEqual(current.inputs);
  expect(applied.edges).toEqual([before.edges[0]]);
});

test("node forms apply connected default outputs and edges without replacing the graph", () => {
  const before = definition();
  const fallback = {
    id: "fallback",
    type: "OUTPUT" as const,
    label: "Default",
    expression: "0",
    position: { x: 300, y: 300 },
  };
  const edited = {
    ...before,
    nodes: [...before.nodes, fallback],
    edges: [
      ...before.edges,
      {
        id: "default",
        source: "branch",
        sourceHandle: "default",
        target: "fallback",
      },
    ],
  };
  const current = patchGraphNode(before, "out", { expression: "9" });
  const applied = applyNodeFormDraft(current, before, edited, "branch")!;
  expect(applied.nodes.find((node) => node.id === "fallback")).toEqual(
    fallback,
  );
  expect(applied.edges).toEqual(edited.edges);
  expect(applied.nodes.find((node) => node.id === "out")?.expression).toBe("9");
});

test("node forms reject conflicting node, edge, and input changes atomically", () => {
  const before = definition();
  const edited = patchGraphNode(before, "branch", {
    label: "Modal name",
    cases: [],
  });
  expect(
    applyNodeFormDraft(
      patchGraphNode(before, "branch", { label: "Newer name" }),
      before,
      edited,
      "branch",
    ),
  ).toBeNull();
  expect(
    applyNodeFormDraft(
      {
        ...before,
        edges: before.edges.map((edge) =>
          edge.id === "case" ? { ...edge, target: "input" } : edge,
        ),
      },
      before,
      edited,
      "branch",
    ),
  ).toBeNull();
  expect(
    applyNodeFormDraft(
      { ...before, inputs: [{ ...before.inputs[0], defaultValue: [9] }] },
      before,
      { ...before, inputs: [{ ...before.inputs[0], defaultValue: [3] }] },
      "input",
    ),
  ).toBeNull();
  expect(
    applyNodeFormDraft(
      { ...before, nodes: before.nodes.filter((node) => node.id !== "branch") },
      before,
      edited,
      "branch",
    ),
  ).toBeNull();
});

test("node forms reject newly dangling concurrent connections while preserving pre-existing incomplete edges", () => {
  const before = definition();
  const edited = patchGraphNode(before, "branch", { cases: [] });
  const newCaseEdge = {
    id: "new-case",
    source: "branch",
    sourceHandle: "case:first",
    target: "input",
  };
  expect(
    applyNodeFormDraft(
      { ...before, edges: [...before.edges, newCaseEdge] },
      before,
      edited,
      "branch",
    ),
  ).toBeNull();

  const removedOutput = {
    ...before,
    nodes: before.nodes.filter((node) => node.id !== "out"),
    edges: before.edges.filter((edge) => edge.target !== "out"),
  };
  const newIncoming = {
    id: "new-incoming",
    source: "input",
    sourceHandle: "next",
    target: "out",
  };
  expect(
    applyNodeFormDraft(
      { ...before, edges: [...before.edges, newIncoming] },
      before,
      removedOutput,
      "branch",
    ),
  ).toBeNull();
  const newOutgoing = {
    id: "new-outgoing",
    source: "out",
    sourceHandle: "next",
    target: "input",
  };
  expect(
    applyNodeFormDraft(
      { ...before, edges: [...before.edges, newOutgoing] },
      before,
      removedOutput,
      "branch",
    ),
  ).toBeNull();

  const incomplete = {
    id: "incomplete",
    source: "branch",
    sourceHandle: "unfinished",
    target: "out",
  };
  const current = { ...before, edges: [...before.edges, incomplete] };
  const applied = applyNodeFormDraft(current, before, edited, "branch")!;
  expect(applied).not.toBeNull();
  expect(applied.edges).toEqual([before.edges[0], incomplete]);
});
