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
import { createRule, publishRule, uniqueId } from "./helpers/api";

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

/**
 * Puts the caret at the end of a text field. An End key with the caret
 * already there is not consumed by the field: Chromium scrolls the inspector
 * to its bottom instead, which would mount the rows there.
 */
async function caretToEnd(field: Locator) {
  await field.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/** Waits until no more inline editors mount for a while and returns how many did. */
async function settledEditors(page: Page): Promise<number> {
  const editors = page.locator(".inline-expression-editor .monaco-editor");
  await expect.poll(() => editors.count()).toBeGreaterThan(0);
  let count = await editors.count();
  for (;;) {
    await page.waitForTimeout(300);
    const next = await editors.count();
    if (next === count) return next;
    count = next;
  }
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
  await caretToEnd(fieldName);
  // The rows' inline editors finish mounting Monaco on their own schedule.
  // Field 1 binds the variable `amount`; the 39 others hold expressions, but
  // only the rows on screen mount an editor: all 39 created in one effect
  // flush blocked the inspector and fanned every completion out 39 times.
  const mounted = await settledEditors(page);
  expect(mounted).toBeLessThan(39);
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(fieldName).toHaveValue("field_10123456789");
  let counts = await renderCounts(page);
  // Every keystroke re-rendered all 40 rows (1,240 sibling-row renders and
  // 1,209 Monaco host renders for 10 keys); now none of the other rows.
  expect(counts.otherRowRenders).toBe(0);
  // Scrolling to the last field mounts its editor in place of the placeholder.
  const last = page.locator(".node-mapping-card").last();
  await expect(last.locator(".inline-expression-placeholder")).toHaveCount(1);
  await page
    .getByLabel("Field 40 name", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(last.locator(".monaco-editor")).toBeVisible();
  await expect(last.locator(".inline-expression-placeholder")).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="choose"] .graph-node').click();
  const caseLabel = page.getByLabel("Case 1 label", { exact: true });
  await expect(page.getByLabel("Case 20 label", { exact: true })).toBeVisible();
  await caseLabel.click();
  await caretToEnd(caseLabel);
  expect(await settledEditors(page)).toBeLessThan(20);
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(caseLabel).toHaveValue("Case 10123456789");
  counts = await renderCounts(page);
  expect(counts.otherRowRenders).toBe(0);
});

// Every parameter card rendered on each keystroke in any card and on each drag
// frame of another node (850 card renders for 10 keys at 50 inputs, about 84 ms
// a keystroke); the cards now take row-identity callbacks and are memoized.
test("typing an input parameter's name or dragging another card leaves the other parameter cards alone", async ({
  page,
  request,
}) => {
  const inputs = Array.from({ length: 50 }, (_, index) => ({
    name: `input_${index + 1}`,
    type: "NUMBER" as const,
    required: true,
    defaultValue: null,
  }));
  const definition: Definition = {
    schemaVersion: 1,
    inputs,
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "input_1",
        position: { x: 0, y: 340 },
      },
    ],
    edges: [{ id: "a", source: "input", target: "out", sourceHandle: "next" }],
  };
  const id = await create(request, "render-cost", definition);
  await openGraph(page, id, "input", 2);
  const names = page.getByLabel("Parameter name", { exact: true });
  await expect(names).toHaveCount(50);
  const first = names.first();
  await first.click();
  await page.keyboard.press("End");
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(first).toHaveValue("input_10123456789");
  let counts = await renderCounts(page);
  expect(counts.commits).toBeGreaterThan(0);
  expect(counts.otherRowRenders).toBe(0);
  // A drag of the Output card edits the draft on every frame.
  const card = page.locator('.react-flow__node[data-id="out"]');
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
  counts = await renderCounts(page);
  expect(counts.commits).toBeGreaterThan(0);
  expect(counts.otherRowRenders).toBe(0);
});

test("typing a Reference parameter mapping leaves the other parameter cards alone", async ({
  page,
  request,
}) => {
  const parameters = Array.from({ length: 20 }, (_, index) => ({
    name: `p${index + 1}`,
    type: "NUMBER" as const,
    required: true,
    defaultValue: null,
  }));
  const child = await createRule(request, {
    id: uniqueId("render-cost-child"),
    kind: "FORMULA",
    definition: {
      schemaVersion: 1,
      inputs: parameters,
      nodes: [
        {
          id: "input",
          type: "INPUT",
          label: "Inputs",
          position: { x: 0, y: 0 },
        },
        {
          id: "out",
          type: "OUTPUT",
          label: "Result",
          expression: "p1",
          position: { x: 0, y: 200 },
        },
      ],
      edges: [
        { id: "a", source: "input", target: "out", sourceHandle: "next" },
      ],
    },
  });
  await publishRule(request, child);
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "reuse",
        type: "REFERENCE",
        label: "Reuse",
        ruleId: child.id,
        version: 1,
        bindings: Object.fromEntries(parameters.map(({ name }) => [name, "1"])),
        output: "reused",
        position: { x: 0, y: 170 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "reused",
        position: { x: 0, y: 340 },
      },
    ],
    edges: [
      { id: "a", source: "input", target: "reuse", sourceHandle: "next" },
      { id: "b", source: "reuse", target: "out", sourceHandle: "next" },
    ],
  };
  const id = await create(request, "render-cost", definition);
  await openGraph(page, id, "reuse", 3);
  await expect(
    page.getByRole("group", { name: "Parameter p20", exact: true }),
  ).toBeVisible();
  const first = page
    .getByRole("group", { name: "Parameter p1", exact: true })
    .getByLabel("p1 *", { exact: true });
  await first.click();
  await page.keyboard.press("End");
  await resetRenderCounts(page);
  await page.keyboard.type("2345", { delay: 60 });
  await expect(first).toHaveValue("12345");
  const counts = await renderCounts(page);
  expect(counts.commits).toBeGreaterThan(0);
  expect(counts.otherRowRenders).toBe(0);
});
