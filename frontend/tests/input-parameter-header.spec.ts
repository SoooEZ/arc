import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

async function createRule(request: APIRequestContext) {
  const id = `input-parameter-header-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 12 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "1",
        position: { x: 200, y: 180 },
      },
    ],
    edges: [
      { id: "next", source: "input", sourceHandle: "next", target: "output" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Rule;
}

test("input headers edit Required/Optional and card counts follow added and removed parameters", async ({
  page,
  request,
}) => {
  const rule = await createRule(request);
  await page.goto(`/#/rules/${rule.id}`);
  const node = page.locator('.react-flow__node[data-id="input"] .graph-node');
  await node.click();
  const sidebar = page.locator(".inspector-sidebar");
  const parameter = sidebar.locator(".input-schema-card").first();
  const title = parameter.locator(".input-card-title");
  await expect(node.locator(".node-detail")).toHaveText("1 input parameter");
  await expect(title.getByText("Parameter 1", { exact: true })).toBeVisible();
  await expect(title.getByLabel("Required", { exact: true })).toBeChecked();
  await expect(parameter.locator(".MuiFormControlLabel-root")).toHaveCount(1);
  await title.getByLabel("Required", { exact: true }).uncheck();
  await expect(title.getByLabel("Optional", { exact: true })).not.toBeChecked();
  await expect(
    parameter.getByLabel("Parameter name", { exact: true }),
  ).toHaveValue("amount");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.inputs).toEqual([
    { ...rule.draft.inputs[0], required: false },
  ]);

  await sidebar
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await expect(node.locator(".node-detail")).toHaveText("2 input parameters");
  const second = sidebar.locator(".input-schema-card").nth(1);
  await expect(
    second.locator(".input-card-title").getByLabel("Required", { exact: true }),
  ).toBeChecked();
  await sidebar
    .getByRole("button", { name: "Remove amount", exact: true })
    .click();
  await expect(node.locator(".node-detail")).toHaveText("1 input parameter");
  await expect(title.getByText("Parameter 1", { exact: true })).toBeVisible();
  await expect(title.getByLabel("Required", { exact: true })).toBeChecked();
  await sidebar
    .getByRole("button", { name: "Remove input2", exact: true })
    .click();
  await expect(node.locator(".node-detail")).toHaveText("0 input parameters");
  await expect(sidebar.locator(".input-schema-card")).toHaveCount(0);
});

test("parameter headers fit narrow layouts and preserve published read-only controls", async ({
  page,
  request,
}) => {
  const rule = await createRule(request);
  expect(
    (
      await request.post(`/api/rules/${rule.id}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${rule.id}?version=1`);
  await page.locator('.react-flow__node[data-id="input"] .graph-node').click();
  const header = page.locator(".inspector-sidebar .input-card-title");
  await expect(header.getByLabel("Required", { exact: true })).toBeChecked();
  await expect(header.getByLabel("Required", { exact: true })).toBeDisabled();
  await expect(
    header.getByRole("button", { name: "Remove amount", exact: true }),
  ).toBeDisabled();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await header.scrollIntoViewIfNeeded();
    await expect(
      header.getByText("Parameter 1", { exact: true }),
    ).toBeVisible();
    await expect(header.getByLabel("Required", { exact: true })).toBeVisible();
    expect(
      await header.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBeTruthy();
    const parameter = await header
      .getByText("Parameter 1", { exact: true })
      .boundingBox();
    const toggle = await header.locator(".input-required-toggle").boundingBox();
    expect(toggle!.x).toBeGreaterThanOrEqual(parameter!.x + parameter!.width);
    expect(
      Math.abs(
        toggle!.y + toggle!.height / 2 - parameter!.y - parameter!.height / 2,
      ),
    ).toBeLessThan(2);
  }
});
