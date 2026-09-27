import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

async function create(request: APIRequestContext, inputCount = 1) {
  const id = `inspector-sections-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 25 },
      ...Array.from({ length: inputCount - 1 }, (_, index) => ({
        name: `field_${index + 1}`,
        type: "NUMBER" as const,
        required: false,
        defaultValue: 0,
      })),
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression: "amount * 2",
        output: "price",
        position: { x: 250, y: 180 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "price",
        position: { x: 250, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "finish", source: "calc", target: "out", sourceHandle: "next" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Rule;
}

test("inspector accordions start expanded and variable help opens above without blocking editing", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const sidebar = page.locator(".inspector-sidebar");
  const expression = sidebar.getByRole("button", {
    name: "Expression",
    exact: true,
  });
  const result = sidebar.getByRole("button", {
    name: "Output As",
    exact: true,
  });
  await expect(expression).toHaveAttribute("aria-expanded", "true");
  await expect(result).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator("button button")).toHaveCount(0);
  await expect(sidebar.locator(".variable-list")).toHaveCount(0);
  const titleStyle = await expression.locator("h4").evaluate((element) => ({
    color: getComputedStyle(element).color,
    weight: getComputedStyle(element).fontWeight,
  }));
  expect(titleStyle).toEqual({ color: "rgb(23, 33, 29)", weight: "700" });
  const geometry = () =>
    sidebar.locator(".inspector-accordion").evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }),
    );
  await expect(
    editorLines(sidebar.getByLabel("Expression", { exact: true })),
  ).toHaveText("amount * 2");
  const before = await geometry();
  const variables = sidebar.getByRole("button", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(variables).toHaveText("Available variables");
  await expect(
    sidebar
      .locator(".inspector-section-heading")
      .getByRole("button", { name: /^Available variables/ }),
  ).toHaveCount(0);
  const normalColor = await variables.evaluate(
    (element) => getComputedStyle(element).color,
  );
  const variableBounds = (await variables.boundingBox())!;
  const editorBounds = (await sidebar
    .locator(".inline-expression-editor")
    .boundingBox())!;
  expect(variableBounds.y + variableBounds.height).toBeLessThanOrEqual(
    editorBounds.y,
  );
  await variables.hover();
  await expect(variables).not.toHaveCSS("color", normalColor);
  const preview = page
    .getByRole("tooltip")
    .filter({ hasText: "Click to keep this list open." });
  await expect(preview.locator(".variable-list code")).toHaveText(["amount"]);
  await expect(preview).toContainText("number");
  await expect(preview).toContainText("Inputs");
  await expect(preview.locator(".expression-variable-tooltip")).toHaveCSS(
    "opacity",
    "1",
  );
  const previewBounds = (await preview
    .locator(".expression-variable-tooltip")
    .boundingBox())!;
  expect(previewBounds.y + previewBounds.height).toBeLessThan(variableBounds.y);
  expect(await geometry()).toEqual(before);
  await page.mouse.move(10, 10);
  await expect(preview).not.toBeVisible();
  await variables.focus();
  await page.keyboard.press("Enter");
  const overlay = page.getByRole("dialog", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(overlay.locator(".variable-list code")).toHaveText(["amount"]);
  await expect(overlay).toHaveAttribute("aria-modal", "false");
  const overlayBounds = (await overlay.boundingBox())!;
  expect(overlayBounds.y + overlayBounds.height).toBeLessThan(variableBounds.y);
  await page.mouse.move(10, 10);
  await expect(overlay).toBeVisible();
  expect(await geometry()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();
  await expect(preview).not.toBeVisible();
  await page.mouse.click(10, 10);
  await expect(overlay).toBeVisible();
  await variables.click();
  await expect(overlay).toBeVisible();
  const inlineEditor = sidebar.getByLabel("Expression", { exact: true });
  await setEditorText(page, inlineEditor, "amount * 3");
  await expect(editorLines(inlineEditor)).toHaveText("amount * 3");
  await expect(inlineEditor).toBeFocused();
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();
  await setEditorText(page, inlineEditor, "amount * 2");
  await overlay
    .getByRole("button", { name: "Close available variables", exact: true })
    .click();
  await expect(overlay).not.toBeVisible();
  await expect(variables).toBeFocused();
  expect(await geometry()).toEqual(before);

  await expression.click();
  await expect(expression).toHaveAttribute("aria-expanded", "false");
  await expect(
    sidebar.getByLabel("Expression", { exact: true }),
  ).not.toBeVisible();
  await expect(
    sidebar.getByLabel("Result variable", { exact: true }),
  ).toBeVisible();
  await expression.click();
  await expect(
    editorLines(sidebar.getByLabel("Expression", { exact: true })),
  ).toHaveText("amount * 2");
  await expression.click();
  await page.locator('.react-flow__node[data-id="out"] .graph-node').click();
  await expect(
    sidebar.getByRole("button", { name: "Output As", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    sidebar.getByRole("button", { name: /^Available variables/ }),
  ).toHaveCount(0);
  await sidebar
    .getByRole("combobox", { name: "Return value · value source", exact: true })
    .click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await sidebar
    .getByRole("button", {
      name: "Available variables · Return value",
      exact: true,
    })
    .click();
  const outputVariables = page.getByRole("dialog", {
    name: "Available variables · Return value",
    exact: true,
  });
  await expect(outputVariables.locator(".variable-list code")).toHaveText([
    "amount",
    "price",
  ]);
  await expect(outputVariables).toContainText("Calculate price");
  await page.keyboard.press("Escape");
  await expect(outputVariables).toBeVisible();
  await page.locator('.react-flow__node[data-id="calc"] .graph-node').click();
  await expect(outputVariables).not.toBeVisible();
  await expect(expression).toHaveAttribute("aria-expanded", "true");
  await expect(
    sidebar.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: test.info().outputPath("inspector-sections-desktop.png"),
  });
});

test("node edit modal shares section controls without losing pending form values", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  await page
    .locator('.react-flow__node[data-id="calc"] .graph-node')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit node · Calculate price",
    exact: true,
  });
  const sections = dialog.locator(
    ".inspector-section-heading .MuiAccordionSummary-root",
  );
  await expect(sections).toHaveCount(2);
  await expect(dialog.getByLabel("Node name", { exact: true })).toHaveCount(1);
  const header = dialog.locator(".node-edit-heading");
  await expect(header.locator(".inspector-node-kind")).toHaveText("Formula");
  const name = header.getByLabel("Node name", { exact: true });
  await name.fill("Pending modal name");
  await expect(name).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Node details", exact: true }),
  ).toHaveCount(0);
  for (const section of await sections.all())
    await expect(section).toHaveAttribute("aria-expanded", "true");
  await dialog
    .getByLabel("Result variable", { exact: true })
    .fill("quoted_price");
  const result = dialog.getByRole("button", {
    name: "Output As",
    exact: true,
  });
  await result.click();
  await expect(
    dialog.getByLabel("Result variable", { exact: true }),
  ).not.toBeVisible();
  await result.click();
  await expect(
    dialog.getByLabel("Result variable", { exact: true }),
  ).toHaveValue("quoted_price");
  await dialog
    .getByRole("button", {
      name: "Available variables · Expression",
      exact: true,
    })
    .click();
  const variables = page.getByRole("dialog", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(variables.locator(".variable-list code")).toHaveText(["amount"]);
  await page.keyboard.press("Escape");
  await expect(variables).toBeVisible();
  await expect(dialog).toBeVisible();
  const expression = dialog.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "amount * 4");
  await expect(editorLines(expression)).toHaveText("amount * 4");
  await expect(expression).toBeFocused();
  await expect(variables).toBeVisible();
  await variables
    .getByRole("button", { name: "Close available variables", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(variables).not.toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Available variables · Expression",
      exact: true,
    }),
  ).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath("inspector-sections-modal.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page
      .locator(".inspector-sidebar")
      .getByLabel("Result variable", { exact: true }),
  ).toHaveValue("price");
  await expect(
    page.locator(".inspector-sidebar").getByLabel("Node name", { exact: true }),
  ).toHaveValue("Calculate price");
});

test("published sections remain inspectable and variable overlays fit mobile without enabling edits", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  expect(
    (
      await request.post(`/api/rules/${rule.id}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const published: Rule = await (
    await request.get(`/api/rules/${rule.id}`)
  ).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/rules/${rule.id}?version=1&node=calc`);
  const sidebar = page.locator(".inspector-sidebar");
  const expression = sidebar.getByRole("button", {
    name: "Expression",
    exact: true,
  });
  await expression.scrollIntoViewIfNeeded();
  await expect(
    sidebar.getByLabel("Result variable", { exact: true }),
  ).toBeDisabled();
  await expression.click();
  await expect(expression).toHaveAttribute("aria-expanded", "false");
  await expression.click();
  const variables = sidebar.getByRole("button", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(variables).toBeEnabled();
  await variables.click();
  const overlay = page.getByRole("dialog", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(overlay.locator(".variable-list code")).toHaveText(["amount"]);
  await expect(overlay).toHaveCSS("opacity", "1");
  const bounds = (await overlay.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  const triggerBounds = (await variables.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThan(triggerBounds.y);
  await page.screenshot({
    path: test.info().outputPath("inspector-sections-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();
  await overlay
    .getByRole("button", { name: "Close available variables", exact: true })
    .click();
  await expect(overlay).not.toBeVisible();
  await expect(
    sidebar.getByLabel("Result variable", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  const after: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(after.revision).toBe(published.revision);
  expect(after.draft).toEqual(rule.draft);
});

test("long pinned variable help scrolls above its editor on mobile and retains an accessible close button", async ({
  page,
  request,
}) => {
  const rule = await create(request, 40);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const trigger = page.getByRole("button", {
    name: "Available variables · Expression",
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const overlay = page.getByRole("dialog", {
    name: "Available variables · Expression",
    exact: true,
  });
  await expect(overlay.locator(".variable-list code")).toHaveCount(40);
  const bounds = (await overlay.boundingBox())!;
  const triggerBounds = (await trigger.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThan(triggerBounds.y);
  const list = overlay.locator(".variable-list");
  expect(
    await list.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(list.locator("code").last()).toBeInViewport();
  const close = overlay.getByRole("button", {
    name: "Close available variables",
    exact: true,
  });
  await expect(close).toBeInViewport();
  await page.screenshot({
    path: test.info().outputPath("pinned-variables-mobile-scroll.png"),
  });
  await close.focus();
  await page.keyboard.press("Escape");
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(overlay).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
