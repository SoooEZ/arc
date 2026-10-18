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
    changedNodes: ["Large?"],
    movedNodes: 1,
    addedConnections: 1,
    removedConnections: 1,
    addedInputs: ["region"],
    removedInputs: ["tier"],
    changedInputs: ["amount"],
    notesChanged: true,
  });
  expect(changeLines(changes)).toEqual([
    "Added: Maybe",
    "Removed: No",
    "Changed: Large?",
    "1 connection added, 1 connection removed",
    "New inputs: region",
    "Removed inputs: tier",
    "Changed inputs: amount",
    "Notes changed",
    "Moved 1 card",
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
  expect(changeLines(versionChanges(published, many))[0]).toBe(
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
  expect(changeLines(changes)).toEqual(["Moved 4 cards"]);
});
