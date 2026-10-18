import { test, expect } from "@playwright/test";
import type { Definition, Rule } from "../../src/types";
import {
  documentReducer,
  initialDocument,
} from "../../src/features/editor/document/documentState";
import {
  patchGraphNode,
  ruleSnapshot,
  semanticGraphKey,
} from "../../src/domain/graph";
import { sameDefinition } from "../../src/domain/definitionEchoes";
import { sampleInputsJson } from "../../src/domain/executionInputs";
import { DecimalNumber } from "../../src/domain/json";
import { exampleRule, clientDraft, serverEcho } from "./document-fixtures";

function editedRule(): Rule {
  return { ...exampleRule(), draft: JSON.parse(clientDraft) as Definition };
}

test("stale layout cannot replace an expression edited while arrangement was pending", () => {
  const start = initialDocument(exampleRule());
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
  const start = initialDocument(exampleRule());
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
  const start = documentReducer(initialDocument(exampleRule()), {
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
  const start = initialDocument(exampleRule());
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
  const start = initialDocument(exampleRule());
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
  const start = documentReducer(initialDocument(exampleRule()), {
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

test("a save echo that respells a number keeps the local draft, one that rescales it does not", () => {
  const submitted = editedRule();
  const withDefault = (value: unknown): Definition => ({
    ...submitted.draft,
    inputs: submitted.draft.inputs.map((input, index) =>
      index === 0 ? { ...input, defaultValue: value } : input,
    ),
  });
  const local = {
    ...submitted,
    draft: withDefault(new DecimalNumber("1.23456789012345678901e5")),
  };
  const start = initialDocument(local);
  // The server echoes plain notation, which used to replace the local draft object.
  const saved = documentReducer(start, {
    type: "rule/saved",
    submitted: local,
    rule: {
      ...local,
      revision: 2,
      draft: withDefault(new DecimalNumber("123456.789012345678901")),
    },
  });
  expect(saved.rule.draft).toBe(start.rule.draft);
  expect(semanticGraphKey(saved.rule.draft)).toBe(
    semanticGraphKey(start.rule.draft),
  );
  expect(
    sameDefinition(
      withDefault(new DecimalNumber("1e400")),
      withDefault(new DecimalNumber("1" + "0".repeat(400))),
    ),
  ).toBe(true);
  expect(
    sameDefinition(withDefault(2.5), withDefault(new DecimalNumber("2.5"))),
  ).toBe(true);
  // A different scale is another number to the server.
  expect(
    sameDefinition(withDefault(new DecimalNumber("2.50")), withDefault(2.5)),
  ).toBe(false);
});
