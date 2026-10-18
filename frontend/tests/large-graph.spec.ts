import { expect, test, type Page } from "@playwright/test";
import type { Definition, RuleNode } from "../src/types";
import { createRule, inputToOutput, uniqueId } from "./helpers/api";
import { canvasNode } from "./helpers/canvas";

/**
 * A chain of `tiers` conditions, each with a formula and an output on its
 * True side: about three cards per tier, one tier below the other.
 */
function tieredChain(tiers: number): Definition {
  const nodes: RuleNode[] = [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
  ];
  const edges: Definition["edges"] = [];
  let previous = "input";
  let handle = "next";
  for (let tier = 1; tier <= tiers; tier++) {
    const y = tier * 300;
    nodes.push(
      {
        id: `check${tier}`,
        type: "CONDITION",
        label: `Tier ${tier}?`,
        position: { x: 0, y: y - 150 },
        expression: `amount >= ${tier * 10}`,
      },
      {
        id: `calc${tier}`,
        type: "FORMULA",
        label: `Rate ${tier}`,
        position: { x: 300, y },
        expression: `amount * ${tier}`,
        output: `r${tier}`,
      },
      {
        id: `out${tier}`,
        type: "OUTPUT",
        label: `Result ${tier}`,
        position: { x: 600, y },
        expression: `r${tier}`,
      },
    );
    edges.push(
      {
        id: `in${tier}`,
        source: previous,
        target: `check${tier}`,
        sourceHandle: handle,
      },
      {
        id: `yes${tier}`,
        source: `check${tier}`,
        target: `calc${tier}`,
        sourceHandle: "true",
      },
      {
        id: `out${tier}`,
        source: `calc${tier}`,
        target: `out${tier}`,
        sourceHandle: "next",
      },
    );
    previous = `check${tier}`;
    handle = "false";
  }
  nodes.push({
    id: "rest",
    type: "OUTPUT",
    label: "Below every tier",
    position: { x: 0, y: tiers * 300 + 300 },
    expression: "0",
  });
  edges.push({
    id: "rest",
    source: previous,
    target: "rest",
    sourceHandle: handle,
  });
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 120 },
    ],
    nodes,
    edges,
  };
}

/** The canvas zoom: the scale of the viewport's transform. */
async function canvasZoom(page: Page): Promise<number> {
  return page
    .locator(".react-flow__viewport")
    .evaluate(
      (viewport) =>
        new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a,
    );
}

const placed = (page: Page) =>
  page.locator(".flow-container:not(.flow-laying-out)");

test("a graph too large to fit readably opens at its Input at a readable zoom", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("large-graph"),
    definition: tieredChain(30),
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(placed(page)).toBeVisible();
  await expect(canvasNode(page, "input")).toBeInViewport();
  // Fitting all 92 cards would need a zoom near 0.06: unreadable.
  expect(await canvasZoom(page)).toBeGreaterThanOrEqual(0.5);
  await expect(canvasNode(page, "rest")).not.toBeInViewport();
});

test("left to right, a large graph opens at its Input as well", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("large-graph-wide"),
    definition: tieredChain(30),
  });
  await page.addInitScript(() =>
    localStorage.setItem("arc.canvas.direction", "horizontal"),
  );
  await page.goto(`/#/rules/${rule.id}`);
  await expect(placed(page)).toBeVisible();
  await expect(canvasNode(page, "input")).toBeInViewport();
  expect(await canvasZoom(page)).toBeGreaterThanOrEqual(0.5);
});

test("a graph that fits readably still opens with every card in view", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("small-graph"),
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(placed(page)).toBeVisible();
  await expect(canvasNode(page, "input")).toBeInViewport();
  await expect(canvasNode(page, "out")).toBeInViewport();
});

test("a long node outline scrolls inside the canvas, clear of the Test panel, and Escape closes it", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("large-outline"),
    definition: tieredChain(30),
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(placed(page)).toBeVisible();
  const outline = page.locator(".node-outline");
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await expect(outline).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(outline).toHaveCount(0);

  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  const panel = page.locator(".test-panel");
  await expect(panel).toBeVisible();
  const list = (await outline.boundingBox())!;
  const below = (await panel.boundingBox())!;
  expect(list.y + list.height).toBeLessThanOrEqual(below.y);
  // Its last entries are reached by scrolling the list itself.
  await outline.getByRole("button", { name: /Below every tier/ }).click();
  await expect(canvasNode(page, "rest")).toBeInViewport();
  await expect(
    outline.getByRole("button", { name: "Close outline", exact: true }),
  ).toBeInViewport();
});
