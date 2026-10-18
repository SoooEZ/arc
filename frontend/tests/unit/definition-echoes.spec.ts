import { test, expect } from "@playwright/test";
import type { BranchCase, Definition, TransformField } from "../../src/types";
import {
  documentReducer,
  initialDocument,
} from "../../src/features/editor/document/documentState";
import { patchGraphNode, ruleSnapshot } from "../../src/domain/graph";
import {
  applyNodeFragment,
  editableDraft,
  sameDefinition,
  withNodePositions,
} from "../../src/domain/definitionEchoes";
import { nodeWidth } from "../../src/domain/nodePorts";
import { addSwitchDefaultReturn } from "../../src/domain/switchBranches";
import { DecimalNumber } from "../../src/domain/json";
import { exampleRule, clientDraft, serverEcho } from "./document-fixtures";

const switchNode: Definition["nodes"][number] = {
  id: "choose",
  type: "SWITCH",
  label: "Choose",
  position: { x: 300, y: 500 },
  cases: [{ id: "one", label: "One", expression: "amount > 1" }],
};

test("definition comparison ignores key order and explicit nulls but not values, order or own __proto__ keys", () => {
  const local = JSON.parse(clientDraft) as Definition;
  const echo = JSON.parse(serverEcho) as Definition;
  expect(sameDefinition(local, echo)).toBe(true);
  expect(
    sameDefinition(local, patchGraphNode(echo, "out", { expression: "0" })),
  ).toBe(false);
  expect(
    sameDefinition(local, { ...echo, edges: [...echo.edges].reverse() }),
  ).toBe(false);
  const withBinding = (value: string) =>
    patchGraphNode(local, "node-abc12345", {
      bindings: JSON.parse(`{"__proto__": "${value}"}`),
    });
  expect(sameDefinition(withBinding("a"), withBinding("a"))).toBe(true);
  expect(sameDefinition(withBinding("a"), withBinding("b"))).toBe(false);
});

test("drafts without node positions get origin positions once they enter the editor, so graph commands can place new nodes", () => {
  const unplaced: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: null as unknown as Definition["nodes"][number]["position"],
      },
      {
        id: "route",
        type: "SWITCH",
        label: "Route",
        position: { x: 400, y: 300 },
        cases: [{ id: "case-1", label: "Big", expression: "true" }],
      },
    ],
    edges: [
      { id: "e1", source: "input", target: "route", sourceHandle: "next" },
    ],
  };
  const opened = initialDocument({ ...exampleRule(), draft: unplaced });
  expect(opened.rule.draft.nodes[0].position).toEqual({ x: 0, y: 0 });
  expect(opened.rule.draft.nodes[1]).toBe(unplaced.nodes[1]);
  expect(ruleSnapshot(opened.rule)).toBe(opened.baseline);
  const withReturn = documentReducer(opened, {
    type: "graph/change",
    change: (definition) =>
      addSwitchDefaultReturn(definition, "route", "0", "fallback", "edge"),
  });
  expect(withReturn.rule.draft.nodes.at(-1)).toMatchObject({
    id: "fallback",
    position: { x: 680, y: 520 },
  });
  const loaded = documentReducer(opened, {
    type: "version/loaded",
    definition: unplaced,
  });
  expect(loaded.rule.draft.nodes[0].position).toEqual({ x: 0, y: 0 });
  const placed = exampleRule().draft;
  expect(initialDocument(exampleRule()).rule.draft.nodes).toEqual(placed.nodes);
});

// A value's own null is part of it: {"a": null} and {} are different
// defaults. Echo comparison dropped every null, so changing a default from one
// to the other in node code kept the old value.
test("a null inside a value is part of it, unlike a record's unset field", () => {
  const draft = (defaultValue: unknown): Definition => ({
    schemaVersion: 1,
    inputs: [
      { name: "payload", type: "OBJECT", required: false, defaultValue },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "In", position: { x: 0, y: 0 } },
    ],
    edges: [],
  });
  expect(sameDefinition(draft({ a: null }), draft({}))).toBe(false);
  expect(sameDefinition(draft({ a: { b: null } }), draft({ a: {} }))).toBe(
    false,
  );
  expect(
    sameDefinition(draft({ a: null, b: 1 }), draft({ b: 1, a: null })),
  ).toBe(true);
  const applied = applyNodeFragment(draft({ a: null }), "input", draft({}));
  expect(applied.inputs[0].defaultValue).toEqual({});
  // A record field the server echoes as null is still unset.
  const unset = draft(null);
  expect(
    sameDefinition(unset, {
      ...unset,
      nodes: [{ ...unset.nodes[0], expression: null, selector: null }],
    }),
  ).toBe(true);
});

// A Transform whose last field was removed is saved with fields: []; the node
// build echoes it as null (a Switch's cases: null comes back as [], a
// Reference's bindings: null as {}). Applying unchanged node code replaced the
// node, dirtied the saved document and reset the preview identity.
test("an empty list or map of a record field equals its null echo, but a default of [] is a value", () => {
  const base = exampleRule().draft;
  const withNode = (node: Definition["nodes"][number]): Definition => ({
    ...base,
    nodes: [...base.nodes, node],
  });
  const transform = (fields: TransformField[] | null) =>
    withNode({
      id: "shape",
      type: "TRANSFORM",
      label: "Shape",
      fields,
      output: "shaped",
      position: { x: 0, y: 300 },
    });
  const local = transform([]);
  expect(sameDefinition(local, transform(null))).toBe(true);
  expect(applyNodeFragment(local, "shape", transform(null))).toBe(local);
  const start = {
    ...initialDocument({ ...exampleRule(), draft: local }),
    source: "code",
  };
  const applied = documentReducer(start, {
    type: "graph/change",
    change: (current) => applyNodeFragment(current, "shape", transform(null)),
  });
  expect(applied).toBe(start);
  expect(ruleSnapshot(applied.rule)).toBe(applied.baseline);
  // A field is a change; so is a different empty collection below a value.
  expect(
    sameDefinition(local, transform([{ name: "a", expression: "1" }])),
  ).toBe(false);
  const choose = (cases: BranchCase[] | null) =>
    withNode({
      id: "choose",
      type: "SWITCH",
      label: "Choose",
      cases,
      position: { x: 0, y: 300 },
    });
  expect(sameDefinition(choose(null), choose([]))).toBe(true);
  const reuse = (bindings: Record<string, string> | null) =>
    withNode({
      id: "reuse",
      type: "REFERENCE",
      label: "Reuse",
      ruleId: "child",
      version: 1,
      bindings,
      output: "child_result",
      position: { x: 0, y: 300 },
    });
  expect(sameDefinition(reuse(null), reuse({}))).toBe(true);
  expect(sameDefinition(reuse({ a: "1" }), reuse({}))).toBe(false);
  const withDefault = (defaultValue: unknown): Definition => ({
    ...base,
    inputs: [{ name: "payload", type: "ARRAY", required: false, defaultValue }],
  });
  expect(sameDefinition(withDefault([]), withDefault(null))).toBe(false);
  expect(sameDefinition(withDefault({}), withDefault(null))).toBe(false);
  expect(sameDefinition(withDefault({ a: [] }), withDefault({ a: null }))).toBe(
    false,
  );
  expect(sameDefinition(withDefault({ a: {} }), withDefault({ a: [] }))).toBe(
    false,
  );
});

// A `source` statement or an API draft without a pointer builds, saves and
// loads with pointer null, which reached the JSON pointer field as value={null}:
// React warned and left the input uncontrolled until the first keystroke.
test("a source binding without a pointer enters the editor as an empty pointer", () => {
  const bound = (pointer: string | null): Definition => ({
    ...exampleRule().draft,
    inputs: [
      {
        name: "rate",
        type: "NUMBER",
        required: false,
        defaultValue: 1,
        source: {
          id: "country-tax",
          version: 1,
          bindings: {},
          pointer,
          onError: "FAIL",
        },
      },
    ],
  });
  expect(editableDraft(bound(null)).inputs[0].source?.pointer).toBe("");
  const placed = bound("/rate");
  expect(editableDraft(placed)).toBe(placed);
  // Opening, building and acknowledging a save all read it so: the document
  // opens clean, and an echo with null keeps the local draft (lesson F1).
  const start = initialDocument({ ...exampleRule(), draft: bound(null) });
  expect(start.rule.draft.inputs[0].source?.pointer).toBe("");
  expect(ruleSnapshot(start.rule)).toBe(start.baseline);
  const built = documentReducer(
    { ...start, source: "code", sourceDirty: true },
    {
      type: "source/built",
      before: "code",
      definition: bound(null),
      source: "code",
    },
  );
  expect(built.rule.draft.inputs[0].source?.pointer).toBe("");
  const saved = documentReducer(start, {
    type: "rule/saved",
    submitted: start.rule,
    rule: { ...start.rule, revision: 2, draft: bound(null) },
  });
  expect(saved.rule.draft).toBe(start.rule.draft);
  expect(ruleSnapshot(saved.rule)).toBe(saved.baseline);
});

test("a node fragment build applies only what the fragment owns and keeps an unchanged draft", () => {
  const start = initialDocument(exampleRule());
  const draft = start.rule.draft;
  // The server echoes explicit nulls, its own key order and the fragment's edges last.
  const echo: Definition = {
    schemaVersion: 1,
    inputs: draft.inputs.map((input) => ({ ...input, source: null })),
    nodes: draft.nodes.map((node) => ({
      ...node,
      output: node.output ?? null,
      ruleId: null,
      bindings: null,
    })) as Definition["nodes"],
    edges: [draft.edges[1], draft.edges[0]],
    notes: null,
  };
  expect(applyNodeFragment(draft, "input", echo)).toBe(draft);
  const applied = documentReducer(start, {
    type: "graph/change",
    change: (current) => applyNodeFragment(current, "input", echo),
  });
  expect(applied).toBe(start);
  expect(ruleSnapshot(applied.rule)).toBe(applied.baseline);
  // A changed fragment replaces its node and outgoing edges, keeping every other object.
  const changed = applyNodeFragment(draft, "left", {
    ...echo,
    nodes: echo.nodes.map((node) =>
      node.id === "left" ? { ...node, expression: "amount * 0.7" } : node,
    ),
    edges: [
      draft.edges[0],
      { id: "b2", source: "left", sourceHandle: "next", target: "output" },
    ],
  });
  expect(changed.nodes[1].expression).toBe("amount * 0.7");
  expect(changed.nodes[0]).toBe(draft.nodes[0]);
  expect(changed.nodes[2]).toBe(draft.nodes[2]);
  expect(changed.edges).toEqual([
    draft.edges[0],
    { id: "b2", source: "left", sourceHandle: "next", target: "output" },
  ]);
  expect(changed.edges[0]).toBe(draft.edges[0]);
  expect(changed.inputs).toBe(draft.inputs);
  // Only an Input fragment brings parameters, and only changed ones.
  const parameters = applyNodeFragment(draft, "input", {
    ...echo,
    inputs: [
      ...echo.inputs,
      { name: "rate", type: "NUMBER", required: true, defaultValue: null },
    ],
  });
  expect(parameters.inputs.map((input) => input.name)).toEqual([
    "amount",
    "rate",
  ]);
  expect(parameters.nodes).toBe(draft.nodes);
  expect(applyNodeFragment(draft, "left", { ...echo, inputs: [] }).inputs).toBe(
    draft.inputs,
  );
});

test("coordinates the server writes as 400.0 become numbers before any position arithmetic", () => {
  // The lossless codec keeps 400.0 as a DecimalNumber; "400.0" + 50 concatenated text, so a
  // default return landed on top of its Switch and the Input connection was blocked.
  const echoed = {
    ...exampleRule().draft,
    nodes: exampleRule().draft.nodes.map((node) => ({
      ...node,
      position: {
        x: new DecimalNumber(`${node.position.x}.0`),
        y: new DecimalNumber(`${node.position.y}.0`),
      },
    })) as unknown as Definition["nodes"],
  };
  const placed = withNodePositions(echoed);
  expect(placed.nodes.map((node) => node.position)).toEqual(
    exampleRule().draft.nodes.map((node) => node.position),
  );
  expect(
    placed.nodes.every((node) => typeof node.position.x === "number"),
  ).toBe(true);
  expect(withNodePositions(placed)).toBe(placed);
  const opened = initialDocument({ ...exampleRule(), draft: echoed });
  expect(opened.rule.draft.nodes[1].position).toEqual({ x: 0, y: 100 });
  // A save echo with such coordinates is the local draft, so the preview result survives the save.
  const start = initialDocument(exampleRule());
  const saved = documentReducer(start, {
    type: "rule/saved",
    submitted: start.rule,
    rule: { ...start.rule, revision: 2, draft: echoed },
  });
  expect(saved.rule.draft).toBe(start.rule.draft);
  expect(saved.rule.revision).toBe(2);
  expect(
    addSwitchDefaultReturn(
      { ...placed, nodes: [...placed.nodes, switchNode] },
      "choose",
      "0",
      "fallback",
      "fallback-edge",
    ).nodes.at(-1)?.position,
  ).toEqual({
    x: Math.max(
      ...[...placed.nodes, switchNode].map(
        (node) => node.position.x + nodeWidth(node) + 50,
      ),
    ),
    y: 720,
  });
});
