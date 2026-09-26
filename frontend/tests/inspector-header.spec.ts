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
  await expect(header.getByLabel("Node name", { exact: true })).toHaveValue(
    "Check eligibility",
  );
  await expect(header.getByText("Condition", { exact: true })).toBeVisible();
  await expect(header.locator(".node-icon svg")).toBeVisible();
  await expect(sidebar.getByText("Node settings", { exact: true })).toHaveCount(
    0,
  );
  await expect(sidebar.locator(".inspector-node-kind")).toHaveCount(1);
  await expect(sidebar.getByLabel("Node name", { exact: true })).toHaveCount(1);
  await expect(
    sidebar
      .locator(".inspector-scroll")
      .getByLabel("Node name", { exact: true }),
  ).toHaveCount(0);

  const deleteNode = header.getByRole("button", {
    name: "Delete node",
    exact: true,
  });
  await expect(deleteNode).toBeEnabled();
  await expect(
    sidebar
      .locator(".inspector-scroll")
      .getByRole("button", { name: "Delete node", exact: true }),
  ).toHaveCount(0);
  expect(
    (await header.locator(".inspector-node-name").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(120);
  await deleteNode.hover();
  await expect(
    page.getByRole("tooltip", { name: "Delete node", exact: true }),
  ).toBeVisible();
  await sidebar.getByLabel("Node name", { exact: true }).fill("Check account");
  await expect(header.getByLabel("Node name", { exact: true })).toHaveValue(
    "Check account",
  );
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
  await expect(header.getByLabel("Node name", { exact: true })).toHaveValue(
    "Result",
  );
  await expect(header.getByText("Output", { exact: true })).toBeVisible();
  await deleteNode.click();
  await expect(page.locator('.react-flow__node[data-id="output"]')).toHaveCount(
    0,
  );
  await expect(header.getByLabel("Node name", { exact: true })).toHaveValue(
    "Inputs",
  );
  await expect(deleteNode).toHaveCount(0);
  await expect(header.locator(".inspector-delete-slot")).toHaveCount(1);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.nodes.map((node) => node.id)).toEqual([
    "input",
    "condition",
  ]);
  expect(saved.draft.edges.map((edge) => edge.id)).toEqual(["start"]);
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
  const heading = header.getByLabel("Node name", { exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveValue(label);
  await expect(header.locator(".inspector-node-name")).toHaveAttribute(
    "title",
    label,
  );
  await expect(sidebar.getByLabel("Node name", { exact: true })).toBeDisabled();
  await expect(
    header.getByRole("button", { name: "Delete node", exact: true }),
  ).toBeDisabled();
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
    const centers = await header.locator(":scope > *").evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.y + bounds.height / 2;
      }),
    );
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
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

test("node errors use one stable header slot and an overlay that can be pinned and dismissed", async ({
  page,
  request,
}, testInfo) => {
  const rule = await createRule(request, "Check eligibility");
  const errors = [
    "First expression is incomplete",
    "Second expression uses an unknown variable",
    "The third branch has no target",
    "Fourth expression has an invalid result type",
  ];
  await page.route("**/api/diagnostics", async (route) => {
    const draft: Definition = route.request().postDataJSON();
    const hasErrors =
      draft.nodes.find((node) => node.id === "condition")?.label ===
      "Show errors";
    await route.fulfill({
      json: hasErrors
        ? errors.map((message) => ({
            message,
            locations: [{ nodeId: "condition" }],
          }))
        : [],
    });
  });
  await page.goto(`/#/rules/${rule.id}`);
  const sidebar = page.locator(".inspector-sidebar");
  const header = sidebar.locator(".inspector-heading");
  const name = header.getByLabel("Node name", { exact: true });
  await expect(name).toHaveValue("Check eligibility");
  await expect(
    header.getByRole("button", { name: /^Node errors/ }),
  ).toHaveCount(0);
  const geometry = () =>
    sidebar.evaluate((element) =>
      [".inspector-heading", ".inspector-node-name", ".inspector-scroll"].map(
        (selector) => {
          const bounds = element
            .querySelector(selector)!
            .getBoundingClientRect();
          return {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          };
        },
      ),
    );
  const before = await geometry();
  await name.fill("Show errors");
  const indicator = header.getByRole("button", {
    name: "Node errors (4)",
    exact: true,
  });
  await expect(indicator).toBeVisible();
  expect(await geometry()).toEqual(before);
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
  await indicator.hover();
  for (const error of errors)
    await expect(page.getByRole("tooltip")).toContainText(error);
  await indicator.click();
  const popover = page.getByRole("dialog", {
    name: "Node errors",
    exact: true,
  });
  await expect(popover.getByRole("listitem")).toHaveCount(4);
  await page.mouse.move(10, 10);
  await expect(popover).toBeVisible();
  expect(await geometry()).toEqual(before);
  await popover.getByRole("button", { name: "Close node errors" }).click();
  await expect(popover).not.toBeVisible();
  await indicator.click();
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
  await indicator.click();
  await page.mouse.click(10, 10);
  await expect(popover).not.toBeVisible();
  await expect(page.locator(".MuiPopover-root")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("inspector-header-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await header.scrollIntoViewIfNeeded();
  await expect(indicator).toBeVisible();
  expect(
    await header.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("inspector-header-mobile.png"),
    fullPage: true,
  });
  await name.fill("Valid again");
  await expect(indicator).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await geometry()).toEqual(before);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route(`**/api/rules/${rule.id}`, async (route) => {
    if (route.request().method() === "PUT") {
      saving = true;
      await held;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => saving).toBe(true);
    await expect(
      header.getByRole("button", { name: "Delete node", exact: true }),
    ).toBeDisabled();
    expect(await geometry()).toEqual(before);
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Delete node", exact: true }),
    ).toBeEnabled();
    expect(await geometry()).toEqual(before);
  } finally {
    release();
  }
});
