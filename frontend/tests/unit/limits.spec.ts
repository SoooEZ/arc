import { expect, test } from "@playwright/test";
import {
  canAddEdge,
  canAddInput,
  canAddNode,
  MAX_DESCRIPTION_CHARACTERS,
  MAX_EDGES,
  MAX_INPUTS,
  MAX_NAME_CHARACTERS,
  MAX_NODES,
  ruleMetadataProblem,
} from "../../src/domain/limits";
import { canAddSwitchDefaultReturn } from "../../src/domain/switchBranches";
import { connectGraphNodes, connectionAllowed } from "../../src/domain/graph";
import type { Definition, RuleEdge, RuleNode } from "../../src/types";

const node = (id: string): RuleNode => ({
  id,
  type: "FORMULA",
  label: id,
  expression: "1",
  position: { x: 0, y: 0 },
});
const filled = (nodes: number, edges: number, inputs = 0): Definition => ({
  schemaVersion: 1,
  inputs: Array.from({ length: inputs }, (_, index) => ({
    name: `p${index}`,
    type: "NUMBER",
    required: true,
    defaultValue: null,
  })),
  nodes: Array.from({ length: nodes }, (_, index) => node(`n${index}`)),
  edges: Array.from({ length: edges }, (_, index): RuleEdge => ({
    id: `e${index}`,
    source: "n0",
    target: `n${index + 1}`,
    sourceHandle: "next",
  })),
});

test("the add predicates refuse exactly at the server's counts", () => {
  expect(canAddNode(filled(MAX_NODES - 1, 0))).toBe(true);
  expect(canAddNode(filled(MAX_NODES, 0))).toBe(false);
  expect(canAddEdge(filled(0, MAX_EDGES - 1))).toBe(true);
  expect(canAddEdge(filled(0, MAX_EDGES))).toBe(false);
  expect(canAddInput(filled(0, 0, MAX_INPUTS - 1))).toBe(true);
  expect(canAddInput(filled(0, 0, MAX_INPUTS))).toBe(false);
});

test("a full draft takes no new connection and no Default return", () => {
  const full = {
    ...filled(3, MAX_EDGES),
    nodes: [
      node("n0"),
      { ...node("choose"), type: "SWITCH" as const, cases: [] },
      { ...node("out"), type: "OUTPUT" as const },
    ],
  };
  expect(connectGraphNodes(full, "n0", "out", "next", "new")).toBe(full);
  expect(canAddSwitchDefaultReturn(full, "choose")).toBe(false);
  // The canvas asks while a handle is dragged: a full draft shows the drop as refused.
  const drop = { source: "n0", target: "out", sourceHandle: "next" };
  expect(connectionAllowed(full, drop)).toBe(false);
  const room = { ...full, edges: full.edges.slice(1) };
  expect(connectionAllowed(room, drop)).toBe(true);
  expect(connectionAllowed(room, { ...drop, target: "n0" })).toBe(false);
  expect(connectionAllowed(room, { ...drop, source: null })).toBe(false);
  expect(connectionAllowed(room, { ...drop, sourceHandle: "case:x" })).toBe(
    false,
  );
  expect(
    connectGraphNodes(room, "n0", "out", "next", "new").edges,
  ).toHaveLength(MAX_EDGES);
  expect(canAddSwitchDefaultReturn(room, "choose")).toBe(true);
});

test("rule metadata problems repeat the server's messages at its boundaries", () => {
  expect(
    ruleMetadataProblem({
      name: "a".repeat(MAX_NAME_CHARACTERS),
      description: "",
    }),
  ).toBeNull();
  expect(
    ruleMetadataProblem({
      name: "a".repeat(MAX_NAME_CHARACTERS + 1),
      description: "",
    }),
  ).toEqual({
    field: "name",
    message: "Rule name must contain 1 to 160 characters",
  });
  expect(ruleMetadataProblem({ name: "   ", description: "" })).toEqual({
    field: "name",
    message: "Rule name must contain 1 to 160 characters",
  });
  // The server trims with Java's String.trim: a no-break space is a name.
  expect(ruleMetadataProblem({ name: "\u00a0", description: "" })).toBeNull();
  // The server refuses a name made only of Java whitespace (String.isBlank), such as the
  // full-width space a Chinese input method types, though String.trim keeps it.
  for (const blank of ["\u3000", "\u2003\u2003", " \u2028 ", " \u205f"])
    expect(ruleMetadataProblem({ name: blank, description: "" })).toEqual({
      field: "name",
      message: `Rule name must contain 1 to ${MAX_NAME_CHARACTERS} characters`,
    });
  expect(
    ruleMetadataProblem({ name: "\u3000Tax", description: "" }),
  ).toBeNull();
  // The server refuses what storage cannot hold first, then any control
  // character (DisplayNames): a pasted tab came back as a generic 422.
  expect(
    ruleMetadataProblem({ name: "\t\u0000Tax\r\n", description: "" }),
  ).toEqual({
    field: "name",
    message: "Text cannot contain the NUL character (U+0000)",
  });
  expect(ruleMetadataProblem({ name: "Tax\trate", description: "" })).toEqual({
    field: "name",
    message: "Rule name cannot contain control characters",
  });
  expect(
    ruleMetadataProblem({ name: "Tax", description: "Rate \ud800" }),
  ).toEqual({
    field: "description",
    message: "Text cannot contain an unpaired UTF-16 surrogate",
  });
  expect(
    ruleMetadataProblem({
      name: ` ${"a".repeat(MAX_NAME_CHARACTERS)}\u00a0`,
      description: "",
    }),
  ).toEqual({
    field: "name",
    message: "Rule name must contain 1 to 160 characters",
  });
  expect(
    ruleMetadataProblem({
      name: "Tax",
      description: "d".repeat(MAX_DESCRIPTION_CHARACTERS),
    }),
  ).toBeNull();
  expect(
    ruleMetadataProblem({
      name: "Tax",
      description: "d".repeat(MAX_DESCRIPTION_CHARACTERS + 1),
    }),
  ).toEqual({
    field: "description",
    message: "Description exceeds 2,000 characters",
  });
});
