import { test, expect } from "@playwright/test";
import {
  documentReducer,
  initialDocument,
} from "../../src/features/editor/document/documentState";
import {
  connectGraphNodes,
  isCurrentGraphLocation,
  isPreviewRoot,
  patchGraphNode,
  removeGraphNode,
  semanticGraphKey,
  updateGraphInputs,
  updateGraphNode,
} from "../../src/domain/graph";
import { exampleRule } from "./document-fixtures";

test("graph mutations preserve fan-out, avoid duplicate edges, and protect Input", () => {
  const definition = exampleRule().draft;
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
  const definition = exampleRule().draft;
  const moved = patchGraphNode(definition, "left", {
    position: { x: 50, y: 75 },
  });
  expect(semanticGraphKey(moved)).toBe(semanticGraphKey(definition));
  expect(JSON.stringify(moved)).not.toBe(JSON.stringify(definition));
  expect(
    semanticGraphKey(patchGraphNode(definition, "left", { expression: "0" })),
  ).not.toBe(semanticGraphKey(definition));
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

// A value-equal edit (a double click on Remove, an expression cleared to "")
// allocated a new draft: the reducer dropped the code buffer and diagnostics
// and every derived identity was computed again, as for a real keystroke.
test("a patch that changes nothing returns the draft itself, so the document keeps its state", () => {
  const start = initialDocument(exampleRule());
  const draft = start.rule.draft;
  expect(patchGraphNode(draft, "missing", { label: "Gone" })).toBe(draft);
  expect(patchGraphNode(draft, "left", {})).toBe(draft);
  expect(
    patchGraphNode(draft, "left", {
      expression: "amount * 0.8",
      label: "First calculation",
    }),
  ).toBe(draft);
  // A key set to undefined clears a value; one already absent is unchanged.
  expect(patchGraphNode(draft, "left", { ruleId: undefined })).toBe(draft);
  expect(
    patchGraphNode(draft, "left", { output: undefined }).nodes[1].output,
  ).toBeUndefined();
  expect(updateGraphNode(draft, "missing", () => ({ label: "Gone" }))).toBe(
    draft,
  );
  expect(
    updateGraphNode(draft, "left", (node) => ({ output: node.output })),
  ).toBe(draft);
  expect(
    updateGraphNode(draft, "left", () => ({ expression: "1" })).nodes[1]
      .expression,
  ).toBe("1");
  expect(updateGraphInputs(draft, (inputs) => inputs)).toBe(draft);
  expect(
    updateGraphInputs(draft, (inputs) => [...inputs, inputs[0]]).inputs,
  ).toHaveLength(2);
  const withCode = documentReducer(start, {
    type: "source/rendered",
    before: draft,
    source: "rule example {}",
  });
  const unchanged = documentReducer(withCode, {
    type: "graph/change",
    change: (current) =>
      patchGraphNode(current, "left", { expression: "amount * 0.8" }),
  });
  expect(unchanged).toBe(withCode);
  expect(unchanged.source).toBe("rule example {}");
});
