import { expect, test } from "@playwright/test";
import { createNavigationGuards } from "../../src/app/navigationGuards";

test("active registrations are listed earliest first, and a release is harmless twice", () => {
  const guards = createNavigationGuards();
  expect(guards.messages()).toEqual([]);
  const releaseSave = guards.register("A source save is still running.");
  const releaseEdits = guards.register("Discard unsaved source changes?");
  expect(guards.messages()).toEqual([
    "A source save is still running.",
    "Discard unsaved source changes?",
  ]);
  releaseSave();
  expect(guards.messages()).toEqual(["Discard unsaved source changes?"]);
  releaseSave();
  expect(guards.messages()).toEqual(["Discard unsaved source changes?"]);
  releaseEdits();
  expect(guards.messages()).toEqual([]);
});

test("equal messages from separate owners are released independently", () => {
  const guards = createNavigationGuards();
  const releaseFirst = guards.register("Unsaved changes");
  const releaseSecond = guards.register("Unsaved changes");
  expect(guards.messages()).toEqual(["Unsaved changes"]);
  releaseFirst();
  expect(guards.messages()).toEqual(["Unsaved changes"]);
  releaseSecond();
  expect(guards.messages()).toEqual([]);
});
