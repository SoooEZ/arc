import { expect, test } from "@playwright/test";
import {
  leavesRuleDocument,
  leaveWarning,
  pagePath,
  parseRoute,
  rulePath,
  sameRuleDocument,
  unsavedRuleWarning,
} from "../../src/app/routing";
import { createNavigationGuards } from "../../src/app/navigationGuards";

test("routes are a discriminated page with rule details only on rule pages", () => {
  expect(parseRoute("/library")).toEqual({ page: "library" });
  expect(parseRoute("/sources")).toEqual({ page: "sources" });
  expect(parseRoute("/playground")).toEqual({ page: "playground" });
  expect(parseRoute("/docs")).toEqual({ page: "docs" });
  expect(parseRoute("/rules/tax?version=3&node=input")).toEqual({
    page: "rule",
    ruleId: "tax",
    mode: "graph",
    version: 3,
    node: "input",
  });
  expect(parseRoute("/studio/tax")).toEqual({
    page: "rule",
    ruleId: "tax",
    mode: "code",
    version: null,
    node: null,
  });
  // Unknown paths render the library, like the empty default route.
  for (const unknown of ["/", "/nope", "/rules", "/rules/a/b", "/constructor"])
    expect(parseRoute(unknown)).toEqual({ page: "library" });
});

// Number() also read 0x10 as version 16, 1e1 as 10, and 1.5 and -2 as
// versions no rule has; only the form rulePath writes names a version.
test("a version is read only in the form a link writes it", () => {
  for (const [text, version] of [
    ["7", 7],
    ["123456789", 123456789],
    ["0x10", null],
    ["1e1", null],
    ["1.5", null],
    ["-2", null],
    ["0", null],
    ["07", null],
    [" 7", null],
    ["1234567890", null],
  ] as const)
    expect(
      parseRoute(`/rules/tax?version=${encodeURIComponent(text)}`),
      text,
    ).toMatchObject({ version });
});

test("graph and code views of one rule version are the same document", () => {
  expect(sameRuleDocument("/rules/tax", "/studio/tax?node=input")).toBe(true);
  expect(sameRuleDocument("/rules/tax", "/rules/tax?version=2")).toBe(false);
  expect(sameRuleDocument("/rules/tax", "/rules/vat")).toBe(false);
  expect(sameRuleDocument("/library", "/library")).toBe(false);
});

test("leaving asks for every registered guard and for a dirty rule document", () => {
  const guards = createNavigationGuards();
  const warning = (from: string, to: string, ruleDirty: boolean) =>
    leaveWarning({
      from,
      to,
      ruleDirty,
      guards: guards.messages({ from, to }),
    });

  expect(warning("/rules/tax", "/library", false)).toBeNull();
  expect(warning("/rules/tax", "/library", true)).toBe(unsavedRuleWarning);
  // The draft survives a graph/code switch of the same rule.
  expect(warning("/rules/tax", "/studio/tax", true)).toBeNull();

  const releaseSources = guards.register(
    "Discard unsaved data source changes?",
  );
  const releaseCopy = guards.register("Discard unsaved data source changes?");
  const releaseSave = guards.register("A data source is still being saved.");
  // An embedded source manager unmounts on a graph/code switch too.
  expect(warning("/rules/tax", "/studio/tax", true)).toBe(
    "Discard unsaved data source changes?\n\nA data source is still being saved.",
  );
  expect(warning("/rules/tax", "/library", true)).toBe(
    [
      "Discard unsaved data source changes?",
      "A data source is still being saved.",
      unsavedRuleWarning,
    ].join("\n\n"),
  );
  releaseSources();
  expect(guards.messages()).toEqual([
    "Discard unsaved data source changes?",
    "A data source is still being saved.",
  ]);
  releaseCopy();
  releaseSave();
  expect(guards.messages()).toEqual([]);
  expect(warning("/sources", "/library", false)).toBeNull();
});

test("a guard scoped to the rule document ignores graph/code switches but not leaving or unloading", () => {
  const guards = createNavigationGuards();
  const warning = (from: string, to: string) =>
    leaveWarning({
      from,
      to,
      ruleDirty: false,
      guards: guards.messages({ from, to }),
    });
  const saving = "The draft is still being saved.";
  const release = guards.register(saving, leavesRuleDocument);

  // The editor, and its pending save, survive these changes.
  expect(warning("/rules/tax", "/studio/tax")).toBeNull();
  expect(warning("/studio/tax", "/rules/tax?node=input")).toBeNull();
  // These close the editor.
  expect(warning("/rules/tax", "/library")).toBe(saving);
  expect(warning("/rules/tax", "/rules/tax?version=2")).toBe(saving);
  expect(warning("/rules/tax", "/rules/vat")).toBe(saving);
  // Unloading the page ends every piece of work.
  expect(guards.messages()).toEqual([saving]);

  const releaseSources = guards.register(
    "Discard unsaved data source changes?",
  );
  expect(warning("/rules/tax", "/studio/tax")).toBe(
    "Discard unsaved data source changes?",
  );
  expect(warning("/rules/tax", "/library")).toBe(
    [saving, "Discard unsaved data source changes?"].join("\n\n"),
  );
  releaseSources();
  release();
  expect(guards.messages()).toEqual([]);
});

test("rulePath writes today's paths and parseRoute reads every one of them back", () => {
  expect(rulePath({ ruleId: "tax" })).toBe("/rules/tax");
  expect(rulePath({ ruleId: "tax", version: 3 })).toBe("/rules/tax?version=3");
  expect(rulePath({ ruleId: "tax", mode: "code" })).toBe("/studio/tax");
  expect(
    rulePath({ ruleId: "tax", mode: "code", version: 2, node: "out" }),
  ).toBe("/studio/tax?version=2&node=out");
  expect(pagePath("library")).toBe("/library");
  expect(pagePath("docs")).toBe("/docs");
  for (const mode of ["graph", "code"] as const)
    for (const version of [null, 3])
      for (const node of [null, "input", "a b/c"]) {
        const route = { page: "rule", ruleId: "tax", mode, version, node };
        expect(
          parseRoute(rulePath({ ruleId: "tax", mode, version, node })),
        ).toEqual(route);
      }
  // IDs are slugs, but the pair round-trips any ID; a malformed escape is an unknown path.
  expect(parseRoute(rulePath({ ruleId: "a/b" }))).toMatchObject({
    ruleId: "a/b",
  });
  expect(parseRoute("/rules/%E0%A4%A")).toEqual({ page: "library" });
});
