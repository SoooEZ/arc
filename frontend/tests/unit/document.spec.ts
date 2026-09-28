import { test, expect } from "@playwright/test";
import type { Definition, Rule } from "../../src/types";
import {
  documentReducer,
  initialDocument,
} from "../../src/features/editor/documentState";
import {
  availableVariables,
  connectGraphNodes,
  inputVariables,
  isCurrentGraphLocation,
  isPreviewRoot,
  patchGraphNode,
  removeGraphNode,
  ruleSnapshot,
  sameDefinition,
  semanticGraphKey,
  variableOptionLabel,
} from "../../src/domain/graph";
import { sampleInputsJson } from "../../src/domain/executionInputs";
import { setSwitchDefaultReturn } from "../../src/domain/switchBranches";
import { selectedNode } from "../../src/features/editor/nodeSelection";
import { nodeErrorsOf } from "../../src/features/editor/useGraphProblems";
import {
  literalText,
  quoteText,
  simpleComparison,
} from "../../src/domain/expressions";
import { sameRuleDocument } from "../../src/app/routing";

const rule = (): Rule => ({
  id: "example",
  name: "Example",
  description: "",
  kind: "FORMULA",
  revision: 1,
  publishedVersion: null,
  createdAt: "",
  updatedAt: "",
  draft: {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
      {
        id: "left",
        type: "FORMULA",
        label: "First calculation",
        expression: "amount * 0.8",
        output: "price",
        position: { x: 0, y: 100 },
      },
      {
        id: "right",
        type: "FORMULA",
        label: "Second calculation",
        expression: "amount * 0.9",
        output: "price",
        position: { x: 300, y: 100 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "price",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [
      { id: "a", source: "input", sourceHandle: "next", target: "left" },
      { id: "b", source: "left", sourceHandle: "next", target: "output" },
    ],
  },
});

test("stale layout cannot replace an expression edited while arrangement was pending", () => {
  const start = initialDocument(rule());
  const edited = documentReducer(start, {
    type: "graph/change",
    change: (definition) =>
      patchGraphNode(definition, "left", { expression: "amount * 0.5" }),
  });
  const arranged = patchGraphNode(start.rule.draft, "left", {
    position: { x: 900, y: 900 },
  });
  const after = documentReducer(edited, {
    type: "graph/arranged",
    before: start.rule.draft,
    definition: arranged,
  });
  expect(after.rule.draft.nodes[1].expression).toBe("amount * 0.5");
  expect(after.rule.draft.nodes[1].position).toEqual({ x: 0, y: 100 });
  expect(ruleSnapshot(after.rule)).not.toBe(after.baseline);
});

test("saving advances the server revision without discarding edits made after submission", () => {
  const start = initialDocument(rule());
  const submitted = start.rule;
  const edited = documentReducer(start, {
    type: "graph/change",
    change: (definition) =>
      patchGraphNode(definition, "left", { expression: "amount * 0.5" }),
  });
  const response = { ...submitted, revision: 2 };
  const completed = documentReducer(edited, {
    type: "rule/saved",
    submitted,
    rule: response,
  });
  expect(completed.rule.draft.nodes[1].expression).toBe("amount * 0.5");
  expect(completed.rule.revision).toBe(2);
  expect(completed.baseline).toBe(ruleSnapshot(response));
  expect(ruleSnapshot(completed.rule)).not.toBe(completed.baseline);
});

test("a build response cannot erase a newer source buffer", () => {
  const start = documentReducer(initialDocument(rule()), {
    type: "source/changed",
    source: "first buffer",
  });
  const edited = documentReducer(start, {
    type: "source/changed",
    source: "newer buffer",
  });
  const completed = documentReducer(edited, {
    type: "source/built",
    before: "first buffer",
    source: "canonical first buffer",
    definition: patchGraphNode(start.rule.draft, "left", { expression: "42" }),
  });
  expect(completed).toBe(edited);
});

test("a late rendered buffer cannot describe an older graph even while source is empty", () => {
  const start = initialDocument(rule());
  const edited = documentReducer(start, {
    type: "graph/change",
    change: (definition) =>
      patchGraphNode(definition, "left", { expression: "42" }),
  });
  const stale = documentReducer(edited, {
    type: "source/rendered",
    before: start.rule.draft,
    source: "outdated graph source",
  });
  expect(stale).toBe(edited);
  const current = documentReducer(stale, {
    type: "source/rendered",
    before: edited.rule.draft,
    source: "current graph source",
  });
  expect(current.source).toBe("current graph source");
  expect(current.sourceDirty).toBe(false);
});

test("code errors retain the user's buffer and draft until a successful build", () => {
  const start = initialDocument(rule());
  const edited = documentReducer(start, {
    type: "source/changed",
    source: "incomplete code",
  });
  const failed = documentReducer(edited, {
    type: "source/diagnostics",
    before: "incomplete code",
    diagnostics: [{ message: "Missing node", line: 1, column: 1 }],
  });
  const lateRender = documentReducer(failed, {
    type: "source/rendered",
    before: start.rule.draft,
    source: "outdated graph source",
  });
  expect(lateRender.source).toBe("incomplete code");
  expect(lateRender.sourceDirty).toBe(true);
  expect(lateRender.rule.draft).toBe(start.rule.draft);
  const draft = patchGraphNode(start.rule.draft, "left", { expression: "42" });
  const built = documentReducer(lateRender, {
    type: "source/built",
    before: "incomplete code",
    definition: draft,
    source: "valid code",
  });
  expect(built.rule.draft).toBe(draft);
  expect(built.sourceDirty).toBe(false);
  expect(built.diagnostics).toEqual([]);
  expect(built.baseline).toBe(start.baseline);
  const saved = documentReducer(built, {
    type: "rule/saved",
    submitted: built.rule,
    rule: { ...built.rule, revision: 2 },
  });
  expect(saved.baseline).toBe(ruleSnapshot(saved.rule));
});

test("graph mutations preserve fan-out, avoid duplicate edges, and protect Input", () => {
  const definition = rule().draft;
  const connected = connectGraphNodes(
    definition,
    "input",
    "right",
    "next",
    "fanout",
  );
  expect(
    connected.edges.filter((edge) => edge.source === "input"),
  ).toHaveLength(2);
  expect(
    connectGraphNodes(connected, "input", "right", "next", "duplicate"),
  ).toBe(connected);
  expect(removeGraphNode(connected, "input")).toBe(connected);
  const removed = removeGraphNode(connected, "left");
  expect(removed.edges.map((edge) => edge.id)).toEqual(["fanout"]);
  expect(definition.nodes).toHaveLength(4);
  const unfinished = { ...definition, nodes: [definition.nodes[3]], edges: [] };
  expect(removeGraphNode(unfinished, "output")).toBe(unfinished);
});

test("moving a card changes the saved draft but not semantic diagnostic identity", () => {
  const definition = rule().draft;
  const moved = patchGraphNode(definition, "left", {
    position: { x: 50, y: 75 },
  });
  expect(semanticGraphKey(moved)).toBe(semanticGraphKey(definition));
  expect(JSON.stringify(moved)).not.toBe(JSON.stringify(definition));
  expect(
    semanticGraphKey(patchGraphNode(definition, "left", { expression: "0" })),
  ).not.toBe(semanticGraphKey(definition));
});

test("variable choices only include guaranteed inputs and upstream results and combine their labels", () => {
  let definition = rule().draft;
  expect(
    availableVariables(definition, "output", ["amount", "price"]),
  ).toContainEqual({
    name: "price",
    type: "RESULT",
    label: "First calculation",
  });
  definition = connectGraphNodes(definition, "right", "output", "next", "join");
  expect(
    availableVariables(definition, "output", ["amount", "price"]).find(
      (value) => value.name === "price",
    )?.label,
  ).toBe("First calculation / Second calculation");
  expect(
    availableVariables(definition, "output", ["amount"]).map(
      (value) => value.name,
    ),
  ).toEqual(["amount"]);
  expect(availableVariables(definition, "output", [])).toEqual([]);
});

test("disconnected nodes and unresolved scope reads do not inherit graph inputs", () => {
  const definition = rule().draft;
  expect(availableVariables(definition, "right", [])).toEqual([]);
  expect(availableVariables(definition, "right")).toEqual([]);
  expect(availableVariables(definition, "output")).toEqual([]);
  expect(availableVariables(definition, "input", ["amount"])).toEqual(
    inputVariables(definition),
  );
  expect(inputVariables(definition)).toEqual([
    { name: "amount", type: "NUMBER", label: "Input" },
  ]);
});

test("variable labels follow producer renames while merged results keep their identity and unknown type", () => {
  const definition = connectGraphNodes(
    rule().draft,
    "right",
    "output",
    "next",
    "join",
  );
  const scope = ["amount", "price"];
  const before = availableVariables(definition, "output", scope);
  const renamed = patchGraphNode(
    patchGraphNode(definition, "input", { label: "Customer inputs" }),
    "left",
    { label: "Compute price" },
  );
  const options = availableVariables(renamed, "output", scope);
  expect(options.map(({ name, type }) => ({ name, type }))).toEqual(
    before.map(({ name, type }) => ({ name, type })),
  );
  expect(options.map(variableOptionLabel)).toEqual([
    "amount [number] from Customer inputs",
    "price [result] from Compute price / Second calculation",
  ]);
  expect(inputVariables(renamed)[0].label).toBe("Customer inputs");
});

test("string constants round-trip escapes and comparison parsing respects quoted operators", () => {
  const text = 'hello "arc" \\ value\n下一行';
  expect(literalText(quoteText(text))).toBe(text);
  expect(literalText("SUM(amount)")).toBeNull();
  expect(simpleComparison('tier == "a > b && c"')?.slice(1)).toEqual([
    "tier",
    "==",
    '"a > b && c"',
  ]);
  expect(simpleComparison("amount > 1 && amount < 10")).toBeNull();
});

test("graph/code navigation preserves a draft but switching published versions does not", () => {
  expect(sameRuleDocument("/rules/example", "/studio/example?node=left")).toBe(
    true,
  );
  expect(
    sameRuleDocument("/rules/example?version=1", "/studio/example?version=1"),
  ).toBe(true);
  expect(sameRuleDocument("/rules/example", "/rules/example?version=1")).toBe(
    false,
  );
  expect(sameRuleDocument("/rules/example", "/rules/other")).toBe(false);
});

// Captured from PUT /api/rules/{id}: a draft edited in the browser (an added
// parameter without `source`, a new node with its own key order) and the
// server's response for it (every record field, unset ones as null).
const clientDraft = `{"schemaVersion":1,"inputs":[{"name":"amount","type":"NUMBER","required":true,"defaultValue":150,"source":null},{"name":"input2","type":"NUMBER","required":true,"defaultValue":null}],"nodes":[{"id":"input","type":"INPUT","label":"Inputs","position":{"x":250,"y":0},"expression":null,"output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"out","type":"OUTPUT","label":"Result","position":{"x":250,"y":200},"expression":"amount","output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"node-abc12345","type":"FORMULA","position":{"x":412.5,"y":97.25},"label":"Formula","expression":"1 + 1","output":"result_2"}],"edges":[{"id":"next","source":"input","target":"out","sourceHandle":"next"},{"id":"e-new","source":"input","target":"node-abc12345","sourceHandle":"next"}],"notes":null}`;
const serverEcho = `{"schemaVersion":1,"inputs":[{"name":"amount","type":"NUMBER","required":true,"defaultValue":150,"source":null},{"name":"input2","type":"NUMBER","required":true,"defaultValue":null,"source":null}],"nodes":[{"id":"input","type":"INPUT","label":"Inputs","position":{"x":250.0,"y":0.0},"expression":null,"output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"out","type":"OUTPUT","label":"Result","position":{"x":250.0,"y":200.0},"expression":"amount","output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"node-abc12345","type":"FORMULA","label":"Formula","position":{"x":412.5,"y":97.25},"expression":"1 + 1","output":"result_2","ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null}],"edges":[{"id":"next","source":"input","target":"out","sourceHandle":"next"},{"id":"e-new","source":"input","target":"node-abc12345","sourceHandle":"next"}],"notes":null}`;

function editedRule(): Rule {
  return { ...rule(), draft: JSON.parse(clientDraft) as Definition };
}

test("a save response that differs only in key order and explicit nulls keeps the local draft and every identity derived from it", () => {
  const start = initialDocument(editedRule());
  const submitted = start.rule;
  const echo = JSON.parse(serverEcho) as Definition;
  expect(JSON.stringify(echo)).not.toBe(JSON.stringify(submitted.draft));
  const saved = documentReducer(start, {
    type: "rule/saved",
    submitted,
    rule: { ...submitted, revision: 2, draft: echo },
  });
  expect(saved.rule.draft).toBe(start.rule.draft);
  expect(saved.rule.revision).toBe(2);
  expect(saved.baseline).toBe(ruleSnapshot(saved.rule));
  expect(semanticGraphKey(saved.rule.draft)).toBe(
    semanticGraphKey(start.rule.draft),
  );
  // The Test panel's untouched sample and the preview identity stay put.
  expect(sampleInputsJson(echo)).toBe(sampleInputsJson(start.rule.draft));
});

test("publishing after a save acknowledges both responses without making the draft dirty or replacing it", () => {
  const start = initialDocument(editedRule());
  const candidate = start.rule;
  const echo = JSON.parse(serverEcho) as Definition;
  const afterSave = documentReducer(start, {
    type: "rule/saved",
    submitted: candidate,
    rule: { ...candidate, revision: 2, draft: echo },
  });
  const published = documentReducer(afterSave, {
    type: "rule/saved",
    submitted: { ...afterSave.rule, draft: candidate.draft },
    rule: {
      ...candidate,
      revision: 3,
      publishedVersion: 1,
      draft: JSON.parse(serverEcho) as Definition,
    },
  });
  expect(published.rule.draft).toBe(start.rule.draft);
  expect(published.rule.publishedVersion).toBe(1);
  expect(ruleSnapshot(published.rule)).toBe(published.baseline);
});

test("save responses adopt the server's stored name and genuinely changed drafts only when nothing changed after submission", () => {
  const start = documentReducer(initialDocument(rule()), {
    type: "rule/metadata",
    patch: { name: "  Spaced name  ", description: "" },
  });
  const submitted = start.rule;
  const normalized = patchGraphNode(submitted.draft, "left", {
    expression: "amount * 0.75",
  });
  const saved = documentReducer(start, {
    type: "rule/saved",
    submitted,
    rule: { ...submitted, name: "Spaced name", revision: 2, draft: normalized },
  });
  expect(saved.rule.name).toBe("Spaced name");
  expect(saved.rule.draft).toBe(normalized);
  expect(ruleSnapshot(saved.rule)).toBe(saved.baseline);

  const edited = documentReducer(start, {
    type: "graph/change",
    change: (definition) =>
      patchGraphNode(definition, "left", { expression: "amount * 0.5" }),
  });
  const late = documentReducer(edited, {
    type: "rule/saved",
    submitted,
    rule: { ...submitted, name: "Spaced name", revision: 2, draft: normalized },
  });
  expect(late.rule.draft).toBe(edited.rule.draft);
  expect(late.rule.name).toBe("  Spaced name  ");
  expect(late.rule.revision).toBe(2);
  expect(ruleSnapshot(late.rule)).not.toBe(late.baseline);
});

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
  const opened = initialDocument({ ...rule(), draft: unplaced });
  expect(opened.rule.draft.nodes[0].position).toEqual({ x: 0, y: 0 });
  expect(opened.rule.draft.nodes[1]).toBe(unplaced.nodes[1]);
  expect(ruleSnapshot(opened.rule)).toBe(opened.baseline);
  const withReturn = documentReducer(opened, {
    type: "graph/change",
    change: (definition) =>
      setSwitchDefaultReturn(definition, "route", "0", "fallback", "edge"),
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
  const placed = rule().draft;
  expect(initialDocument(rule()).rule.draft.nodes).toEqual(placed.nodes);
});

test("the selection falls back to the default node when a loaded version or build removes the selected node", () => {
  const current = rule().draft;
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
});

test("preview roots are recognised by the sentinel and a null version; published versions of this rule are referenced graphs", () => {
  const draft = { ruleId: "tax", version: null };
  expect(isPreviewRoot({ ruleId: "preview", version: null })).toBe(true);
  expect(isPreviewRoot({ ruleId: "preview", version: 1 })).toBe(false);
  expect(isCurrentGraphLocation({ ruleId: null, version: null }, draft)).toBe(
    true,
  );
  expect(
    isCurrentGraphLocation({ ruleId: "preview", version: null }, draft),
  ).toBe(true);
  // A published rule whose ID is "preview", called through a Reference.
  expect(isCurrentGraphLocation({ ruleId: "preview", version: 1 }, draft)).toBe(
    false,
  );
  // This rule's own published version, called through a Reference.
  expect(isCurrentGraphLocation({ ruleId: "tax", version: 2 }, draft)).toBe(
    false,
  );
  expect(
    isCurrentGraphLocation(
      { ruleId: "tax", version: 2 },
      { ruleId: "tax", version: 2 },
    ),
  ).toBe(true);
});

test("node errors use own keys for prototype-named node IDs and ignore child locations of a rule named preview", () => {
  const ids = ["constructor", "toString", "valueOf", "__proto__"];
  const definition: Definition = {
    ...rule().draft,
    nodes: ids.map((id, index) => ({
      id,
      type: "OUTPUT",
      label: id,
      expression: "1",
      position: { x: 0, y: index * 100 },
    })),
    edges: [],
  };
  const errors = nodeErrorsOf({
    shown: { ruleId: "parent", version: null },
    definition,
    problems: [
      {
        message: "Missing value",
        locations: [
          { ruleId: null, version: null, nodeId: "valueOf", label: "v" },
          { ruleId: null, version: null, nodeId: "__proto__", label: "p" },
        ],
      },
      {
        message: "Division by zero",
        locations: [
          { ruleId: "preview", version: 1, nodeId: "toString", label: "c" },
          {
            ruleId: "preview",
            version: null,
            nodeId: "constructor",
            label: "r",
          },
        ],
      },
    ],
    inherited: [],
    invalidDefaults: false,
    nodeCode: null,
  });
  expect([...errors]).toEqual([
    ["valueOf", ["Missing value"]],
    ["__proto__", ["Missing value"]],
    ["constructor", ["Division by zero"]],
  ]);
  expect(errors.get("toString")).toBeUndefined();
  expect(errors.get("hasOwnProperty")).toBeUndefined();
});
