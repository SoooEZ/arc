import { expect, test } from "@playwright/test";
import {
  acceptsEdits,
  commandsIdle,
  editorCapabilities,
  invalidDefaultMessage,
  pendingWriteWarning,
  shownView,
  viewToggleLabel,
  type EditorTask,
} from "../../src/features/editor/editorCapabilities";

const tasks: (EditorTask | "")[] = [
  "",
  "save",
  "validate",
  "publish",
  "build",
  "switch",
  "test",
  "layout",
  "delete",
];

test("capabilities match the conditions each control used to spell out", () => {
  for (const readOnly of [false, true])
    for (const task of tasks)
      for (const dirty of [false, true]) {
        const busy = task !== "";
        const status = { readOnly, task, versionReady: true, dirty };
        // Before the gate, controls checked `readOnly || busy` (plus `!dirty`
        // for Save) or only `busy` for commands that keep the draft.
        expect(editorCapabilities(status), JSON.stringify(status)).toEqual({
          edit: !readOnly && !busy,
          arrange: !readOnly && !busy,
          save: !readOnly && !busy && dirty,
          publish: !readOnly && !busy,
          validate: !busy,
          test: !busy,
          switchView: !busy,
          openSettings: !busy,
          delete: !readOnly && !busy,
        });
      }
});

test("edits and commands check the same rules as the controls", () => {
  for (const readOnly of [false, true])
    for (const task of tasks)
      for (const versionReady of [false, true]) {
        const status = { readOnly, task, versionReady, dirty: true };
        const can = editorCapabilities(status);
        expect(acceptsEdits(status), JSON.stringify(status)).toBe(can.edit);
        expect(commandsIdle(status), JSON.stringify(status)).toBe(can.test);
      }
});

test("nothing is allowed before the shown version loads", () => {
  for (const readOnly of [false, true])
    expect(
      Object.values(
        editorCapabilities({
          readOnly,
          task: "",
          versionReady: false,
          dirty: true,
        }),
      ),
    ).not.toContain(true);
});

test("leaving asks only while a write may still reach the server", () => {
  expect(pendingWriteWarning("save")).toBe(
    "The draft is still being saved. Leave anyway? The save may not finish.",
  );
  expect(pendingWriteWarning("publish")).toBe(
    "A version is still being published. Leave anyway? Publishing may not finish.",
  );
  for (const task of tasks.filter(
    (task) => !["save", "publish"].includes(task),
  ))
    expect(pendingWriteWarning(task), task).toBeNull();
});

test("invalid-default refusals name the blocked action", () => {
  expect(
    [
      "selecting another node",
      "opening node code",
      "opening another node editor",
      "renaming another node",
      "changing views",
      "saving or changing views",
    ].map(invalidDefaultMessage),
  ).toEqual([
    "Fix the invalid parameter default before selecting another node",
    "Fix the invalid parameter default before opening node code",
    "Fix the invalid parameter default before opening another node editor",
    "Fix the invalid parameter default before renaming another node",
    "Fix the invalid parameter default before changing views",
    "Fix the invalid parameter default before saving or changing views",
  ]);
});

test("unbuilt code stays shown and an invalid default keeps the graph", () => {
  const view = (
    requested: "graph" | "code",
    sourceDirty: boolean,
    invalidDefaults: boolean,
  ) => shownView(requested, { sourceDirty, invalidDefaults });
  expect(view("graph", false, false)).toBe("graph");
  expect(view("code", false, false)).toBe("code");
  // A route change to the graph shows the code until its build succeeds.
  expect(view("graph", true, false)).toBe("code");
  expect(view("graph", true, true)).toBe("code");
  expect(view("code", true, true)).toBe("code");
  // Code does not open while the Input form holds an invalid default.
  expect(view("code", false, true)).toBe("graph");
  expect(view("graph", false, true)).toBe("graph");
});

test("the header toggle describes leaving the shown view, not the route", () => {
  expect(viewToggleLabel("code")).toBe("Graph view");
  expect(viewToggleLabel("graph")).toBe("Code editor");
  // Unbuilt code at the graph route keeps the code on screen: the toggle leaves it.
  expect(
    viewToggleLabel(
      shownView("graph", { sourceDirty: true, invalidDefaults: false }),
    ),
  ).toBe("Graph view");
});
