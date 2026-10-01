import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, RuleNode } from "../src/types";
import {
  installRenderProbe,
  renderCounts,
  resetRenderCounts,
} from "./helpers/renderProbe";
import { createRule, uniqueId } from "./helpers/api";

/** A chain of `count` nodes: Input, Formulas, one Output. */
function chain(count: number): Definition {
  const nodes: RuleNode[] = [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
  ];
  for (let index = 1; index < count - 1; index++)
    nodes.push({
      id: `n${index}`,
      type: "FORMULA",
      label: `Step ${index}`,
      expression: index === 1 ? "amount" : `v${index - 1}`,
      output: `v${index}`,
      position: { x: (index % 8) * 300, y: Math.floor(index / 8) * 160 + 160 },
    });
  nodes.push({
    id: "out",
    type: "OUTPUT",
    label: "Result",
    expression: `v${count - 2}`,
    position: { x: 0, y: Math.ceil(count / 8) * 160 + 200 },
  });
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `e${index}`,
      source: nodes[index].id,
      target: node.id,
      sourceHandle: "next",
    })),
  };
}

async function create(
  request: APIRequestContext,
  prefix: string,
  definition: Definition,
) {
  const id = uniqueId(`${prefix}`);
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  return id;
}

/** Waits until `count` inline editors are mounted and no more mount for a while. */
async function settledEditors(page: Page, count: number) {
  const editors = page.locator(".inline-expression-editor .monaco-editor");
  await expect(editors).toHaveCount(count);
  await page.waitForTimeout(300);
}

/** The element's box once the viewport animation has stopped moving it. */
async function settledBox(page: Page, locator: Locator) {
  let box = (await locator.boundingBox())!;
  for (;;) {
    await page.waitForTimeout(150);
    const next = (await locator.boundingBox())!;
    if (next.x === box.x && next.y === box.y) return next;
    box = next;
  }
}

async function openGraph(page: Page, id: string, node: string, cards: number) {
  await installRenderProbe(page);
  await page.goto(`/#/rules/${id}?node=${node}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(cards);
  await expect(page.getByLabel("Node name", { exact: true })).toBeVisible();
}

test("editing a name on a 100-node rule re-renders about one card per keystroke", async ({
  page,
  request,
}) => {
  const id = await create(request, "render-cost", chain(100));
  await openGraph(page, id, "n1", 100);
  const name = page.getByLabel("Node name", { exact: true });
  await name.click();
  await page.keyboard.press("End");
  await resetRenderCounts(page);
  await page.keyboard.type("abcdefg", { delay: 80 });
  await expect(name).toHaveValue("Step 1abcdefg");
  const counts = await renderCounts(page);
  // Inline handlers and an unmemoized card re-rendered every card on every
  // canvas render: 1,600 card renders for 7 keys; now only the renamed card.
  expect(counts.cardRenders).toBeLessThanOrEqual(7 * 2);
  // A read start stored a state the render already derived, so each keystroke
  // rendered the canvas twice (16 for 7 keys): once now, plus the diagnostics
  // answer and the first keystroke's dirty flag.
  expect(counts.canvasRenders).toBeLessThan(7 * 2);
});

test("dragging one card and selecting cards re-render only the cards involved", async ({
  page,
  request,
}) => {
  const id = await create(request, "render-cost", chain(60));
  await openGraph(page, id, "input", 60);
  const card = page.locator('.react-flow__node[data-id="n1"]');
  // The deep link centres the viewport with an animation; drag once it has settled.
  const box = await settledBox(page, card);
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await resetRenderCounts(page);
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(
      box.x + box.width / 2 + step * 4,
      box.y + 12 + step * 3,
    );
  }
  await page.mouse.up();
  const after = (await card.boundingBox())!;
  expect(after.x).toBeGreaterThan(box.x + 60);
  let counts = await renderCounts(page);
  // A 20-step drag rendered every card on every step (1,399 renders); now the dragged card.
  expect(counts.cardRenders).toBeLessThanOrEqual(2 * 22);
  await resetRenderCounts(page);
  for (const node of ["n3", "n4", "n5", "n6"])
    await page
      .locator(`.react-flow__node[data-id="${node}"] .graph-node`)
      .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Step 6",
  );
  counts = await renderCounts(page);
  // Four selections rendered 248 cards; now the card left and the card entered.
  expect(counts.cardRenders).toBeLessThanOrEqual(2 * 4);
});

// An open trace re-rendered every step on each frame of a drag (about 17 ms a
// frame with 1,000 steps); its rows depend on the graph's structure alone.
test("dragging a card leaves an open execution trace alone", async ({
  page,
  request,
}) => {
  const id = await create(request, "trace-cost", chain(60));
  await openGraph(page, id, "input", 60);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.locator(".trace-list > button")).toHaveCount(60);
  // The deep link centred the Input card above the Test panel.
  const card = page.locator('.react-flow__node[data-id="input"]');
  const box = await settledBox(page, card);
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await resetRenderCounts(page);
  for (let step = 1; step <= 20; step++)
    await page.mouse.move(
      box.x + box.width / 2 + step * 4,
      box.y + 12 + step * 3,
    );
  await page.mouse.up();
  expect((await card.boundingBox())!.x).toBeGreaterThan(box.x + 60);
  expect((await renderCounts(page)).traceRenders).toBe(0);
});

test("typing into one Transform field or Switch case leaves the other rows alone", async ({
  page,
  request,
}) => {
  const fields = Array.from({ length: 40 }, (_, index) => ({
    name: `field_${index + 1}`,
    expression: index === 0 ? "amount" : `amount + ${index}`,
  }));
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "shape",
        type: "TRANSFORM",
        label: "Shape",
        fields,
        output: "shaped",
        position: { x: 0, y: 170 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose",
        cases: Array.from({ length: 20 }, (_, index) => ({
          id: `case-${index + 1}`,
          label: `Case ${index + 1}`,
          expression: `amount > ${index}`,
        })),
        position: { x: 400, y: 170 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "shaped",
        position: { x: 0, y: 340 },
      },
    ],
    edges: [
      { id: "a", source: "input", target: "shape", sourceHandle: "next" },
      { id: "b", source: "shape", target: "out", sourceHandle: "next" },
    ],
  };
  const id = await create(request, "render-cost", definition);
  await openGraph(page, id, "shape", 4);
  const fieldName = page.getByLabel("Field 1 name", { exact: true });
  await expect(page.getByLabel("Field 40 name", { exact: true })).toBeVisible();
  await fieldName.click();
  await page.keyboard.press("End");
  // The rows' inline editors finish mounting Monaco on their own schedule.
  // Field 1 binds the variable `amount`; the 39 others hold expressions.
  await settledEditors(page, 39);
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(fieldName).toHaveValue("field_10123456789");
  let counts = await renderCounts(page);
  // Every keystroke re-rendered all 40 rows (1,240 sibling-row renders and
  // 1,209 Monaco host renders for 10 keys); now none of the other rows.
  expect(counts.otherRowRenders).toBe(0);
  await page.locator('.react-flow__node[data-id="choose"] .graph-node').click();
  const caseLabel = page.getByLabel("Case 1 label", { exact: true });
  await expect(page.getByLabel("Case 20 label", { exact: true })).toBeVisible();
  await caseLabel.click();
  await page.keyboard.press("End");
  await settledEditors(page, 20);
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(caseLabel).toHaveValue("Case 10123456789");
  counts = await renderCounts(page);
  expect(counts.otherRowRenders).toBe(0);
});
