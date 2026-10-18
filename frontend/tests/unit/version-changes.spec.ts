import { test, expect } from "@playwright/test";
import type { Definition } from "../../src/types";
import { changeLines, versionChanges } from "../../src/domain/versionChanges";
import { parseJson } from "../../src/domain/json";
import { connectGraphNodes, patchGraphNode } from "../../src/domain/graph";
import { editableDraft } from "../../src/domain/definitionEchoes";

const published: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    { name: "tier", type: "STRING", required: false, defaultValue: "basic" },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Large?",
      position: { x: 0, y: 150 },
      expression: "amount >= 100",
    },
    {
      id: "yes",
      type: "OUTPUT",
      label: "Yes",
      position: { x: -100, y: 300 },
      expression: "1",
    },
    {
      id: "no",
      type: "OUTPUT",
      label: "No",
      position: { x: 100, y: 300 },
      expression: "0",
    },
  ],
  edges: [
    { id: "a", source: "input", target: "check", sourceHandle: "next" },
    { id: "b", source: "check", target: "yes", sourceHandle: "true" },
    { id: "c", source: "check", target: "no", sourceHandle: "false" },
  ],
};

test("a draft equal to the version as the server stores it changes nothing", () => {
  // The server echoes unset fields as null and writes coordinates as 0.0; the
  // editor reads a version as it reads a draft (editableDraft).
  const stored = parseJson(
    JSON.stringify(published).replaceAll('"x":0,"y":0', '"x":0.0,"y":0.0'),
  ) as Definition;
  const changes = versionChanges(editableDraft(stored), published);
  expect(changes.identical).toBe(true);
  expect(changeLines(changes)).toEqual([]);
});

test("changes name nodes by label and inputs by name, and count moves and connections", () => {
  let draft = patchGraphNode(published, "check", {
    expression: "amount > 100",
  });
  draft = {
    ...draft,
    nodes: [
      ...draft.nodes.filter((node) => node.id !== "no"),
      {
        id: "maybe",
        type: "OUTPUT" as const,
        label: "Maybe",
        position: { x: 300, y: 300 },
        expression: "2",
      },
    ].map((node) =>
      node.id === "yes" ? { ...node, position: { x: -120, y: 320 } } : node,
    ),
    edges: draft.edges.filter((edge) => edge.target !== "no"),
    inputs: [
      { ...draft.inputs[0], required: false },
      { name: "region", type: "STRING", required: false, defaultValue: null },
    ],
    notes: ["Large orders start at 100."],
  };
  draft = connectGraphNodes(draft, "check", "maybe", "false", "d");
  const changes = versionChanges(published, draft);
  expect(changes).toMatchObject({
    identical: false,
    addedNodes: ["Maybe"],
    removedNodes: ["No"],
    changedNodes: [
      {
        name: "Large?",
        fields: [
          {
            field: "Condition",
            before: "amount >= 100",
            after: "amount > 100",
          },
        ],
      },
    ],
    movedNodes: 1,
    addedConnections: 1,
    removedConnections: 1,
    addedInputs: ["region"],
    removedInputs: ["tier"],
    renamedInputs: [],
    changedInputs: [
      {
        name: "amount",
        fields: [{ field: "Required", before: "yes", after: "no" }],
      },
    ],
    notesChanged: true,
  });
  expect(changeLines(changes).map((line) => line.text)).toEqual([
    "Added: Maybe",
    "Removed: No",
    "Changed: Large?",
    "1 connection added, 1 connection removed",
    "New inputs: region",
    "Removed inputs: tier",
    "Changed input: amount",
    "Notes changed",
    "Moved 1 card",
  ]);
});

test("a changed node lists each property before and after, an input renamed in place is a rename", () => {
  const draft: Definition = {
    ...published,
    inputs: [
      {
        name: "orderTotal",
        type: "NUMBER",
        required: true,
        defaultValue: null,
      },
      { ...published.inputs[1], defaultValue: "gold" },
    ],
    nodes: published.nodes.map((node) => {
      if (node.id === "check")
        return {
          ...node,
          type: "SWITCH" as const,
          label: "Size",
          expression: undefined,
          cases: [
            { id: "case-1", label: "Large", expression: "orderTotal >= 100" },
          ],
        };
      if (node.id === "yes")
        return { ...node, expression: "orderTotal", outputName: "total" };
      return node;
    }),
  };
  const changes = versionChanges(published, draft);
  expect(changes.renamedInputs).toEqual([{ from: "amount", to: "orderTotal" }]);
  expect(changes.addedInputs).toEqual([]);
  expect(changes.removedInputs).toEqual([]);
  expect(changes.changedInputs).toEqual([
    {
      name: "tier",
      fields: [{ field: "Default", before: '"basic"', after: '"gold"' }],
    },
  ]);
  expect(changes.changedNodes).toEqual([
    {
      name: "Size",
      fields: [
        { field: "Name", before: "Large?", after: "Size" },
        { field: "Kind", before: "Condition", after: "Condition with cases" },
        { field: "Condition", before: "amount >= 100", after: null },
        { field: "Case Large", before: null, after: "orderTotal >= 100" },
      ],
    },
    {
      name: "Yes",
      fields: [
        { field: "Returns", before: "1", after: "orderTotal" },
        { field: "Output name", before: null, after: "total" },
      ],
    },
  ]);
  expect(changeLines(changes).map((line) => line.text)).toEqual([
    "Changed: Size",
    "Changed: Yes",
    "Renamed input: amount → orderTotal",
    "Changed input: tier",
  ]);
});

test("long name lists are shortened and a layout change alone still counts", () => {
  const many = {
    ...published,
    nodes: [
      ...published.nodes,
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `extra${index}`,
        type: "OUTPUT" as const,
        label: `Extra ${index}`,
        position: { x: index * 300, y: 600 },
        expression: "0",
      })),
    ],
  };
  expect(changeLines(versionChanges(published, many))[0].text).toBe(
    "Added: Extra 0, Extra 1, Extra 2, Extra 3, Extra 4 and 2 more",
  );
  const movedOnly = {
    ...published,
    nodes: published.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 10, y: node.position.y },
    })),
  };
  const changes = versionChanges(published, movedOnly);
  expect(changes.identical).toBe(false);
  expect(changeLines(changes).map((line) => line.text)).toEqual([
    "Moved 4 cards",
  ]);
});
