import { test, expect } from "@playwright/test";
import type { Rule } from "../../src/types";
import {
  documentReducer,
  initialDocument,
} from "../../src/features/editor/documentState";
import {
  availableVariables,
  connectGraphNodes,
  inputVariables,
  patchGraphNode,
  removeGraphNode,
  ruleSnapshot,
  semanticGraphKey,
  variableOptionLabel,
} from "../../src/domain/graph";
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
    "amount (number) - Customer inputs",
    "price (result) - Compute price / Second calculation",
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
