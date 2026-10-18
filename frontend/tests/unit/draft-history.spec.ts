import { test, expect } from "@playwright/test";
import type { Definition, Rule } from "../../src/types";
import {
  documentReducer,
  initialDocument,
  type DocumentState,
} from "../../src/features/editor/document/documentState";
import {
  editGroup,
  noHistory,
  recordEdit,
} from "../../src/domain/draftHistory";
import {
  connectGraphNodes,
  patchGraphNode,
  updateGraphInputs,
} from "../../src/domain/graph";

const draft: Definition = {
  schemaVersion: 1,
  inputs: [{ name: "amount", type: "NUMBER", required: true, defaultValue: 1 }],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calc",
      position: { x: 0, y: 150 },
      expression: "amount",
      output: "total",
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Out",
      position: { x: 0, y: 300 },
      expression: "total",
    },
  ],
  edges: [{ id: "a", source: "input", target: "calc", sourceHandle: "next" }],
};
const rule: Rule = {
  id: "history",
  name: "History",
  description: "",
  kind: "FORMULA",
  draft,
  revision: 1,
  publishedVersion: null,
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:00Z",
};
const moved = (definition: Definition, id: string, y: number): Definition => ({
  ...definition,
  nodes: definition.nodes.map((node) =>
    node.id === id ? { ...node, position: { x: 0, y } } : node,
  ),
});
const edit = (
  state: DocumentState,
  change: (definition: Definition) => Definition,
  at?: number,
) => documentReducer(state, { type: "graph/change", change, at });

test("an edit's group says which repeatable edit it is, or null for a step of its own", () => {
  expect(
    editGroup(
      draft,
      patchGraphNode(draft, "calc", { expression: "amount * 2" }),
    ),
  ).toBe("node:calc:expression");
  expect(editGroup(draft, moved(draft, "calc", 160))).toBe("move:calc");
  expect(
    editGroup(
      draft,
      updateGraphInputs(draft, (inputs) => [{ ...inputs[0], defaultValue: 2 }]),
    ),
  ).toBe("inputs");
  expect(
    editGroup(draft, connectGraphNodes(draft, "calc", "out", "next", "b")),
  ).toBeNull();
  expect(
    editGroup(draft, { ...draft, nodes: draft.nodes.slice(0, 2) }),
  ).toBeNull();
  const both = patchGraphNode(
    patchGraphNode(draft, "calc", { label: "A" }),
    "out",
    { label: "B" },
  );
  expect(editGroup(draft, both)).toBeNull();
});

test("typing and dragging within a second are one step; a pause or another edit starts a new one", () => {
  const typed = patchGraphNode(draft, "calc", { expression: "amount + 1" });
  const more = patchGraphNode(typed, "calc", { expression: "amount + 10" });
  let history = recordEdit(noHistory, draft, typed, 1_000);
  history = recordEdit(history, typed, more, 1_800);
  expect(history.past).toEqual([draft]);
  // After a pause, the next keystroke is a step of its own.
  const later = patchGraphNode(more, "calc", { expression: "amount + 100" });
  history = recordEdit(history, more, later, 3_000);
  expect(history.past).toEqual([draft, more]);
  // Another field of the same node is another step, even at once.
  const renamed = patchGraphNode(later, "calc", { label: "Total" });
  history = recordEdit(history, later, renamed, 3_100);
  expect(history.past).toHaveLength(3);
  // An edit without a time (Arrange, a code build) never joins.
  history = recordEdit(history, renamed, moved(renamed, "out", 999));
  expect(history.past).toHaveLength(4);
  expect(history.last).toBeNull();
});

test("undo and redo step through the drafts, and a new edit clears what was undone", () => {
  let state = initialDocument(rule);
  const first = state.rule.draft;
  state = edit(state, (d) => patchGraphNode(d, "calc", { label: "A" }), 1_000);
  state = edit(
    state,
    (d) => connectGraphNodes(d, "calc", "out", "next", "b"),
    5_000,
  );
  const connected = state.rule.draft;
  state = documentReducer(state, { type: "graph/undo" });
  expect(state.rule.draft.edges).toHaveLength(1);
  expect(state.rule.draft.nodes[1].label).toBe("A");
  state = documentReducer(state, { type: "graph/undo" });
  expect(state.rule.draft).toBe(first);
  expect(documentReducer(state, { type: "graph/undo" })).toBe(state);
  state = documentReducer(state, { type: "graph/redo" });
  state = documentReducer(state, { type: "graph/redo" });
  expect(state.rule.draft).toBe(connected);
  expect(documentReducer(state, { type: "graph/redo" })).toBe(state);
  state = documentReducer(state, { type: "graph/undo" });
  state = edit(state, (d) => moved(d, "out", 400), 9_000);
  expect(state.history.future).toEqual([]);
});

test("unbuilt code is never discarded by a step, and a build that changes nothing records none", () => {
  let state = edit(
    initialDocument(rule),
    (d) => patchGraphNode(d, "calc", { label: "A" }),
    1_000,
  );
  state = documentReducer(state, { type: "source/changed", source: "edited" });
  expect(documentReducer(state, { type: "graph/undo" })).toBe(state);
  const built = documentReducer(state, {
    type: "source/built",
    before: "edited",
    definition: structuredClone(state.rule.draft),
    source: "edited",
  });
  expect(built.history).toBe(state.history);
  const version = documentReducer(built, {
    type: "version/loaded",
    definition: draft,
  });
  expect(version.history.past).toEqual([]);
});
