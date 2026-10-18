import { test, expect } from "@playwright/test";
import type { Definition, RuleNode } from "../../src/types";
import {
  clearSpot,
  spotAfterExit,
} from "../../src/features/editor/canvas/nodePlacement";

const card = (
  id: string,
  x: number,
  y: number,
  type: RuleNode["type"] = "OUTPUT",
): RuleNode => ({
  id,
  type,
  label: id,
  position: { x, y },
  expression: "1",
});
const graph = (...nodes: RuleNode[]): Definition => ({
  schemaVersion: 1,
  inputs: [],
  nodes,
  edges: [],
});
const size = { width: 230, height: 105 };
const unmeasured = new Map();

test("a new card takes the wanted spot when it is clear", () => {
  expect(
    clearSpot(graph(card("a", 0, 0)), unmeasured, { x: 400, y: 0 }, size),
  ).toEqual({
    x: 400,
    y: 0,
  });
});

test("a crowded spot moves along the row, to the first side first, then down a row", () => {
  const crowded = graph(card("a", 0, 0));
  expect(clearSpot(crowded, unmeasured, { x: 10, y: 0 }, size)).toEqual({
    x: 10 + 254,
    y: 0,
  });
  // Left first: one column left of a spot left of the card is clear.
  expect(
    clearSpot(crowded, unmeasured, { x: -10, y: 0 }, size, "left"),
  ).toEqual({ x: -10 - 254, y: 0 });
  // One column left of a spot right of the card is still too close, so the
  // search goes on to the right.
  expect(clearSpot(crowded, unmeasured, { x: 10, y: 0 }, size, "left")).toEqual(
    { x: 10 + 254, y: 0 },
  );
});

test("a card added after an exit starts under that exit, a step below its card", () => {
  const check = card("check", 0, 0, "CONDITION");
  const definition = graph(check);
  // True is the left exit and False the right one; each child goes to its side.
  const afterTrue = spotAfterExit(definition, unmeasured, check, "true", size);
  const afterFalse = spotAfterExit(
    definition,
    unmeasured,
    check,
    "false",
    size,
  );
  expect(afterTrue.y).toBe(105 + 80);
  expect(afterTrue.x).toBeLessThan(afterFalse.x);
  // A sibling already under True pushes the next True child further left.
  const crowded = graph(check, card("first", afterTrue.x, afterTrue.y));
  expect(
    spotAfterExit(crowded, unmeasured, check, "true", size).x,
  ).toBeLessThan(afterTrue.x);
});
