import { expect, test } from "@playwright/test";
import {
  activeNavigationGuard,
  createNavigationGuards,
} from "../../src/app/navigationGuards";

test("navigation guards report the earliest active registration", () => {
  const guards = createNavigationGuards();
  expect(guards.first()).toBeNull();
  const releaseSave = guards.register("A source save is still running.");
  const releaseEdits = guards.register("Discard unsaved source changes?");
  expect(guards.first()).toBe("A source save is still running.");
  releaseSave();
  expect(guards.first()).toBe("Discard unsaved source changes?");
  releaseSave();
  expect(guards.first()).toBe("Discard unsaved source changes?");
  releaseEdits();
  expect(guards.first()).toBeNull();
  expect(activeNavigationGuard()).toBeNull();
});

test("equal messages from separate owners are released independently", () => {
  const guards = createNavigationGuards();
  const releaseFirst = guards.register("Unsaved changes");
  const releaseSecond = guards.register("Unsaved changes");
  releaseFirst();
  expect(guards.first()).toBe("Unsaved changes");
  releaseSecond();
  expect(guards.first()).toBeNull();
});
