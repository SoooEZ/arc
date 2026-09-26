import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, RuleNode } from "../src/types";

const node = (
  id: string,
  type: RuleNode["type"],
  expression?: string,
  output?: string,
  y = 0,
): RuleNode => ({
  id,
  type,
  label: id,
  expression,
  output,
  position: { x: 250, y },
});
const edge = (source: string, target: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle: "next",
});
async function create(
  request: APIRequestContext,
  id: string,
  definition: Definition,
  publish = false,
) {
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  const rule = await response.json();
  if (publish)
    expect(
      (
        await request.post(`/api/rules/${id}/publish`, {
          data: { revision: rule.revision },
        })
      ).ok(),
    ).toBeTruthy();
}
async function replaceCode(page: Page, code: string) {
  await page
    .getByRole("dialog")
    .locator(".monaco-editor")
    .click({ position: { x: 220, y: 50 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}

test("node expressions edit one node, group functions, and flag all invalid expressions live", async ({
  page,
  request,
}) => {
  const id = `node-editor-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node("calc", "FORMULA", "missing + 1", "total", 180),
      node("out", "OUTPUT", "1 +", undefined, 360),
    ],
    edges: [edge("input", "calc"), edge("calc", "out")],
  };
  await create(request, id, definition);
  const original = await (await request.get(`/api/rules/${id}`)).json();
  await page.goto(`/#/rules/${id}`);
  const calc = page.locator('.react-flow__node[data-id="calc"] .graph-node');
  const out = page.locator('.react-flow__node[data-id="out"] .graph-node');
  await expect(calc).toHaveClass(/node-error/);
  await expect(out).toHaveClass(/node-error/);
  const nodeHeight = await calc.evaluate(
    (e) => e.getBoundingClientRect().height,
  );
  await calc.locator(".node-error-message").hover();
  await expect(page.getByRole("tooltip")).toContainText("missing");
  await page
    .getByRole("button", { name: "Node expression · calc", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · calc",
    exact: true,
  });
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  await expect(dialog.locator(".view-lines")).toContainText("let total");
  await expect(dialog.locator(".view-lines")).not.toContainText('node "out"');
  await expect(dialog.locator(".function-group-heading")).not.toHaveCount(0);
  await expect(dialog.locator(".function-chips")).toHaveCount(0);
  await dialog.getByRole("button", { name: /^Math/ }).click();
  await expect(dialog.locator(".function-chips")).toHaveCount(1);
  await dialog.getByPlaceholder("Search functions…").fill("SUM");
  await dialog
    .locator(".function-chips")
    .getByRole("button", { name: "$SUM", exact: true })
    .hover();
  await expect(page.getByRole("tooltip", { name: /^\$SUM\(/ })).toContainText(
    "Aggregates",
  );
  await replaceCode(
    page,
    'node calc FORMULA "Calculation" at (250, 180) { let total = 3 +; next -> out; }',
  );
  await expect(
    dialog.getByRole("button", { name: "Apply to graph" }),
  ).toBeDisabled();
  await expect(dialog.getByRole("alert").first()).toContainText(
    "Incomplete expression",
  );
  await replaceCode(
    page,
    'node calc FORMULA "Calculation" at (250, 180) { let total = $SUM([3, 4]); next -> out; }',
  );
  await expect(
    dialog.getByRole("button", { name: "Apply to graph" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply to graph" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(calc).not.toHaveClass(/node-error/);
  expect(
    await calc.evaluate((e) => e.getBoundingClientRect().height),
  ).toBeCloseTo(nodeHeight, 1);
  await expect(out).toHaveClass(/node-error/);
  await page
    .getByRole("button", { name: "Node expression · out", exact: true })
    .click();
  await replaceCode(
    page,
    'node out OUTPUT "Final" at (250, 360) { return total; }',
  );
  await page.getByRole("button", { name: "Apply to graph" }).click();
  await expect(out).not.toHaveClass(/node-error/);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("7");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await (await request.get(`/api/rules/${id}`)).json();
  expect(
    saved.draft.nodes.find((n: RuleNode) => n.id === "calc").expression,
  ).toBe("$SUM([3, 4])");
  expect(saved.draft.nodes.find((n: RuleNode) => n.id === "input")).toEqual(
    original.draft.nodes[0],
  );
});

test("references navigate within one modal with back and close all while preserving the parent", async ({
  page,
  request,
  context,
}) => {
  const stamp = Date.now(),
    child = `node-modal-child-${stamp}`,
    parent = `node-modal-parent-${stamp}`;
  const childDefinition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      {
        ...node("reuse", "REFERENCE", undefined, "discount", 180),
        ruleId: "apply-discount",
        version: 1,
        bindings: { amount: "100", rate: '"invalid"' },
      },
      node("out", "OUTPUT", "discount", undefined, 360),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  };
  await create(request, child, childDefinition, true);
  const definition: Definition = {
    ...childDefinition,
    nodes: [
      node("input", "INPUT"),
      {
        ...node("reuse", "REFERENCE", undefined, "result", 180),
        ruleId: child,
        version: 1,
        bindings: {},
      },
      node("out", "OUTPUT", "result", undefined, 360),
    ],
  };
  await create(request, parent, definition);
  await page.goto(`/#/rules/${parent}?node=reuse`);
  await page
    .getByLabel("Node name", { exact: true })
    .fill("Parent unsaved edit");
  await page
    .getByRole("button", { name: "Open referenced rule", exact: true })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "Referenced rule viewer",
    exact: true,
  });
  await expect(
    viewer.getByRole("heading", { name: child, exact: true }),
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: "Node outline", exact: true })
    .click();
  await viewer
    .locator(".node-outline")
    .getByRole("button", { name: /reuse/ })
    .click();
  await viewer
    .getByRole("button", { name: "Open referenced rule", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    viewer.getByRole("heading", { name: "Apply discount", exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Back", exact: true }),
  ).toBeEnabled();
  await expect(
    viewer.getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  await viewer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    viewer.getByRole("heading", { name: child, exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Back", exact: true }),
  ).toBeDisabled();
  await viewer.getByRole("button", { name: "Test rule", exact: true }).click();
  await viewer.getByRole("button", { name: "Run test", exact: true }).click();
  await viewer
    .getByRole("button", { name: "Open problem · Amount & rate", exact: true })
    .click();
  await expect(
    viewer.locator('.react-flow__node[data-id="input"] .graph-node'),
  ).toHaveClass(/node-error/);
  await viewer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    viewer.locator('.react-flow__node[data-id="reuse"] .graph-node'),
  ).toHaveClass(/node-error/);
  await viewer
    .getByRole("button", { name: "Code editor", exact: true })
    .click();
  await expect(viewer.locator(".monaco-editor")).toBeVisible();
  await expect(viewer.locator(".view-lines")).toContainText(
    'use "apply-discount"',
  );
  await viewer.getByRole("button", { name: "Close all", exact: true }).click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Parent unsaved edit",
  );
  await expect(page).toHaveURL(new RegExp(`/rules/${parent}`));
  expect(context.pages()).toHaveLength(1);
});
