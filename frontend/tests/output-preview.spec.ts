import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";

test("Output previews distinguish their value from the field returned by multiple reached Outputs", async ({
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
  const id = `output-preview-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: "Output return preview", kind: "RULE", definition },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/#/rules/${id}?node=node-dfe76b5c`);
  const preview = page.getByLabel("Return value preview", { exact: true });
  await expect(preview).toContainText("When only this Output runs");
  await expect(preview).toContainText("When multiple Outputs run");
  await expect(preview.locator("code")).toHaveText([
    "amount",
    '{ "node-dfe76b5c": amount, … }',
  ]);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const run = async (expected: unknown) => {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText(
      JSON.stringify(expected),
    );
  };
  await run({ "node-dfe76b5c": 100, result: 72 });
  await page.getByLabel("Output name", { exact: true }).fill("original_amount");
  await expect(preview.locator("code")).toHaveText([
    '{ "original_amount": amount }',
    '{ "node-dfe76b5c": { "original_amount": amount }, … }',
  ]);
  await run({ "node-dfe76b5c": { original_amount: 100 }, result: 72 });
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
    '{ "result": total, … }',
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
