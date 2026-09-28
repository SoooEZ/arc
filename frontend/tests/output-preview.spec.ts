import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import { setEditorText } from "./helpers/editor";

function fanOutDefinition(): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Test Input",
        position: { x: 200, y: 0 },
      },
      {
        id: "calculate",
        type: "FORMULA",
        label: "Calculate",
        expression: "amount * 0.72",
        output: "total",
        position: { x: 400, y: 180 },
      },
      {
        id: "node-dfe76b5c",
        type: "OUTPUT",
        label: "Original amount",
        expression: "amount",
        position: { x: 0, y: 360 },
      },
      {
        id: "result",
        type: "OUTPUT",
        label: "Final amount",
        expression: "total",
        position: { x: 400, y: 360 },
      },
    ],
    edges: [
      {
        id: "start",
        source: "input",
        target: "calculate",
        sourceHandle: "next",
      },
      {
        id: "original",
        source: "input",
        target: "node-dfe76b5c",
        sourceHandle: "next",
      },
      {
        id: "final",
        source: "calculate",
        target: "result",
        sourceHandle: "next",
      },
    ],
  };
}

async function create(request: APIRequestContext, definition: Definition) {
  const id = `output-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await request.post("/api/rules", {
    data: { id, name: "Output return preview", kind: "RULE", definition },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return id;
}

/** Runs the preview; `expected` is the result's JSON text, or an object that has no decimal places. */
async function run(page: Page, expected: string | object) {
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText(
    typeof expected === "string" ? expected : JSON.stringify(expected),
  );
}

test("multiple Output previews use variable names and aliases as top-level fields without nested wrappers", async ({
  page,
  request,
}) => {
  const id = await create(request, fanOutDefinition());
  await page.goto(`/#/rules/${id}?node=node-dfe76b5c`);
  const preview = page.getByLabel("Return value preview", { exact: true });
  await expect(preview).toContainText("When only this Output runs");
  await expect(preview).toContainText("When multiple Outputs run");
  await expect(preview.locator("code")).toHaveText([
    "amount",
    '{ "amount": amount, … }',
  ]);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await run(page, '{"amount":100,"total":72.00}');
  await page.getByLabel("Output name", { exact: true }).fill("original_amount");
  await expect(preview.locator("code")).toHaveText([
    '{ "original_amount": amount }',
    '{ "original_amount": amount, … }',
  ]);
  await run(page, '{"original_amount":100,"total":72.00}');
  await expect(
    page.getByRole("combobox", { name: "Return value", exact: true }),
  ).toHaveText("amount [number] from Test Input");
  await page.screenshot({
    path: test.info().outputPath("multiple-output-preview.png"),
  });
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.locator('.react-flow__node[data-id="result"] .graph-node').click();
  await expect(preview.locator("code")).toHaveText([
    "total",
    '{ "total": total, … }',
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("combobox", { name: "Return value", exact: true }),
  ).toHaveText("total [result] from Calculate");
  const box = await preview.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: test.info().outputPath("multiple-output-preview-mobile.png"),
  });
});

test("constant, dotted and computed Output expressions fall back to the node ID without an explicit name", async ({
  page,
  request,
}) => {
  const definition = fanOutDefinition();
  definition.inputs.push({
    name: "customer",
    type: "OBJECT",
    required: true,
    defaultValue: { amount: 7 },
  });
  const id = await create(request, definition);
  await page.goto(`/#/rules/${id}?node=result`);
  await page
    .getByRole("combobox", { name: "Return value · value source", exact: true })
    .click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const preview = page.getByLabel("Return value preview", { exact: true });
  for (const [expression, value] of [
    ["42", "42"],
    ["true", "true"],
    ["total + 1", "73.00"],
    ["customer.amount", "7"],
  ] as const) {
    await setEditorText(
      page,
      page.getByLabel("Return value", { exact: true }),
      expression,
    );
    await expect(preview.locator("code")).toHaveText([
      expression,
      `{ "result": ${expression}, … }`,
    ]);
    await run(page, `{"amount":100,"result":${value}}`);
  }
  await setEditorText(
    page,
    page.getByLabel("Return value", { exact: true }),
    "  total  ",
  );
  await expect(preview.locator("code").last()).toHaveText(
    '{ "total":   total  , … }',
  );
  await run(page, '{"amount":100,"total":72.00}');
});

test("duplicate reached Output fields fail with both node locations and recover after renaming", async ({
  page,
  request,
}) => {
  const definition = fanOutDefinition();
  definition.nodes.find((node) => node.id === "node-dfe76b5c")!.outputName =
    "total";
  const id = await create(request, definition);
  await page.goto(`/#/rules/${id}?node=node-dfe76b5c`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const response = page.waitForResponse(
    (received) =>
      received.url().endsWith("/api/preview") &&
      received.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  const failed = await response;
  expect(failed.status()).toBe(422);
  const error = await failed.json();
  expect(error.message).toBe(
    "Duplicate output field 'total'; set distinct Output names",
  );
  expect(
    error.locations
      .map((location: { nodeId: string }) => location.nodeId)
      .sort(),
  ).toEqual(["node-dfe76b5c", "result"]);
  await expect(page.locator(".test-output").getByRole("alert")).toContainText(
    error.message,
  );
  for (const nodeId of ["node-dfe76b5c", "result"]) {
    await expect(
      page.locator(`.react-flow__node[data-id="${nodeId}"] .graph-node`),
    ).toHaveClass(/node-error/);
  }
  await page
    .getByRole("button", { name: "Show problem · Final amount", exact: true })
    .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Final amount",
  );
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Original amount/ })
    .click();
  await page.getByLabel("Output name", { exact: true }).fill("original_amount");
  await run(page, '{"original_amount":100,"total":72.00}');
  await expect(page.locator(".graph-node.node-error")).toHaveCount(0);
});

test("mutually exclusive Outputs can share an alias and retain single-Output wrapped or raw results", async ({
  page,
  request,
}) => {
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "choose",
        type: "CONDITION",
        label: "Choose",
        expression: "amount >= 50",
        position: { x: 200, y: 160 },
      },
      {
        id: "high",
        type: "OUTPUT",
        label: "High",
        expression: "amount",
        outputName: "value",
        position: { x: 0, y: 320 },
      },
      {
        id: "low",
        type: "OUTPUT",
        label: "Low",
        expression: "amount * 2",
        outputName: "value",
        position: { x: 400, y: 320 },
      },
    ],
    edges: [
      { id: "next", source: "input", sourceHandle: "next", target: "choose" },
      { id: "true", source: "choose", sourceHandle: "true", target: "high" },
      { id: "false", source: "choose", sourceHandle: "false", target: "low" },
    ],
  };
  const id = await create(request, definition);
  await page.goto(`/#/rules/${id}?node=low`);
  const preview = page.getByLabel("Return value preview", { exact: true });
  await expect(preview.locator("code")).toHaveText([
    '{ "value": amount * 2 }',
    '{ "value": amount * 2, … }',
  ]);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await run(page, { value: 100 });
  await setEditorText(
    page,
    page.getByLabel("Test input JSON", { exact: true }),
    '{"amount":25}',
  );
  await run(page, { value: 50 });
  await expect(page.locator(".graph-node.node-error")).toHaveCount(0);
  await page.getByLabel("Output name", { exact: true }).fill("");
  await expect(preview.locator("code")).toHaveText([
    "amount * 2",
    '{ "low": amount * 2, … }',
  ]);
  await run(page, 50);
});
