import { expect, test } from "@playwright/test";
import { branchBadge } from "../../src/features/execution/ExecutionResult";
import type { Definition, Step } from "../../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "In", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Check",
      expression: "true",
      position: { x: 0, y: 100 },
    },
    {
      id: "pick",
      type: "SWITCH",
      label: "Pick",
      cases: [{ id: "high", label: "High value", expression: "true" }],
      position: { x: 0, y: 200 },
    },
  ],
  edges: [],
};
const step = (patch: Partial<Step>): Step => ({
  ruleId: "r",
  version: null,
  nodeId: "pick",
  label: "Pick",
  type: "SWITCH",
  value: null,
  branch: null,
  depth: 0,
  ...patch,
});

test("trace badges caption a branch with its exit, marking the fallback exits", () => {
  expect(branchBadge(step({ branch: "case:high" }), definition)).toEqual({
    text: "High value",
    fallback: false,
  });
  expect(branchBadge(step({ branch: "default" }), definition)).toEqual({
    text: "Default",
    fallback: true,
  });
  expect(
    branchBadge(step({ nodeId: "check", branch: "false" }), definition),
  ).toEqual({ text: "False", fallback: true });
  expect(
    branchBadge(step({ nodeId: "check", branch: "true" }), definition),
  ).toEqual({ text: "True", fallback: false });
  // A plain next exit has no caption, and a step without a branch no badge.
  expect(
    branchBadge(step({ nodeId: "input", branch: "next" }), definition),
  ).toBeNull();
  expect(branchBadge(step({}), definition)).toBeNull();
  // Nested rules and unknown nodes show the handle as recorded.
  expect(
    branchBadge(step({ depth: 1, branch: "case:high" }), definition),
  ).toEqual({ text: "case:high", fallback: false });
  expect(
    branchBadge(step({ nodeId: "gone", branch: "default" }), definition),
  ).toEqual({
    text: "default",
    fallback: false,
  });
});
