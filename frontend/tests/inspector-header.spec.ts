import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

async function createRule(request: APIRequestContext, label: string) {
  const id = `inspector-header-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "condition",
        type: "CONDITION",
        label,
        expression: "true",
        position: { x: 200, y: 180 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "1",
        position: { x: 200, y: 360 },
      },
    ],
    edges: [
      {
        id: "start",
        source: "input",
        sourceHandle: "next",
        target: "condition",
      },
      {
        id: "yes",
        source: "condition",
        sourceHandle: "true",
        target: "output",
      },
      {
        id: "no",
        source: "condition",
        sourceHandle: "false",
        target: "output",
      },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Rule;
}

test("the sidebar header follows node selection and name edits, retaining the expression action", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, "Check eligibility");
  await page.goto(`/#/rules/${rule.id}`);
  const sidebar = page.locator(".inspector-sidebar");
  const header = sidebar.locator(".inspector-heading");
  await page
    .locator('.react-flow__node[data-id="condition"] .graph-node')
    .click();
  await expect(
    header.getByRole("heading", { name: "Check eligibility", exact: true }),
  ).toBeVisible();
  await expect(header.getByText("Condition", { exact: true })).toBeVisible();
  await expect(header.locator(".node-icon svg")).toBeVisible();
  await expect(sidebar.getByText("Node settings", { exact: true })).toHaveCount(
    0,
  );
  await expect(sidebar.locator(".inspector-node-title")).toHaveCount(1);

  await sidebar.getByLabel("Node name", { exact: true }).fill("Check account");
  await expect(
    header.getByRole("heading", { name: "Check account", exact: true }),
  ).toBeVisible();
  await header
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Check account",
    exact: true,
  });
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sidebar.getByLabel("Node name", { exact: true })).toHaveValue(
    "Check account",
  );

  await page.locator('.react-flow__node[data-id="output"] .graph-node').click();
  await expect(
    header.getByRole("heading", { name: "Result", exact: true }),
  ).toBeVisible();
  await expect(header.getByText("Output", { exact: true })).toBeVisible();
});

test("long names fit the sidebar header on narrow screens and remain inspectable in a published version", async ({
  page,
  request,
}) => {
  const label = "Eligibility".repeat(14);
  const rule = await createRule(request, label);
  expect(
    (
      await request.post(`/api/rules/${rule.id}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${rule.id}?version=1`);
  await page
    .locator('.react-flow__node[data-id="condition"] .graph-node')
    .click();
  const sidebar = page.locator(".inspector-sidebar");
  const header = sidebar.locator(".inspector-heading");
  const heading = header.getByRole("heading", { name: label, exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveAttribute("title", label);
  await expect(sidebar.getByLabel("Node name", { exact: true })).toBeDisabled();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await header.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
    expect(
      await header.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBeTruthy();
    const bounds = await header.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(
      header.getByRole("button", { name: "Node expression", exact: true }),
    ).toBeVisible();
  }
  await header
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Node expression · ${label}`,
    exact: true,
  });
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply to graph" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading).toBeVisible();
});
