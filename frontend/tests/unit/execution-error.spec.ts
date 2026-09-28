import { expect, test } from "@playwright/test";
import { offersInputEditing } from "../../src/features/execution/ExecutionError";

test("editing the test inputs is offered for unlocated failures and failures at the Input node", () => {
  // A required-input failure is located at the Input node; the panel offered only "Show problem".
  expect(offersInputEditing([{ nodeId: "input" }], true, "input")).toBe(true);
  expect(offersInputEditing([], false, "input")).toBe(true);
  expect(offersInputEditing([{ nodeId: "calc" }], true, "input")).toBe(false);
  // A failure located only in a referenced rule, or in a draft without an Input node.
  expect(offersInputEditing([], true, "input")).toBe(false);
  expect(offersInputEditing([{ nodeId: "input" }], true, null)).toBe(false);
});
