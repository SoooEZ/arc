import { setEditorText } from "./helpers/editor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";

async function createRule(
  request: APIRequestContext,
  id: string,
  publish = false,
) {
  const definition: Definition = {
    schemaVersion: 1,
    notes: ["Keep graph notes"],
    inputs: [
      { name: "payload", type: "ARRAY", required: false, defaultValue: [] },
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
        label: "Calculate",
        expression: "3 + 4",
        output: "total",
        position: { x: 250, y: 180 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "total",
        position: { x: 250, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "calc" },
      { id: "finish", source: "calc", sourceHandle: "next", target: "out" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  const rule: Rule = await response.json();
  if (publish)
    expect(
      (
        await request.post(`/api/rules/${id}/publish`, {
          data: { revision: rule.revision },
        })
      ).ok(),
    ).toBeTruthy();
  return rule;
}

const card = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"] .graph-node`);
async function openMenu(page: Page, id: string) {
  await card(page, id).click({ button: "right" });
  return page.getByRole("menu", { name: "Node actions" });
}

test("node context menu edits in a roomy form, cancels safely, and deletes its target and connections", async ({
  page,
  request,
}) => {
  const id = `node-context-${Date.now()}`;
  const original = await createRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await card(page, "input").click();
  let menu = await openMenu(page, "calc");
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit node/ });
  await expect(dialog.getByLabel("Node name", { exact: true })).toHaveValue(
    "Calculate",
  );
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(650);
  await dialog
    .getByLabel("Node name", { exact: true })
    .fill("Discard this name");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card(page, "calc")).toContainText("Calculate");
  menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await dialog
    .getByLabel("Node name", { exact: true })
    .fill("Updated calculation");
  await setEditorText(
    page,
    dialog.getByRole("textbox", { name: "Expression", exact: true }),
    "6 * 7",
  );
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(card(page, "calc")).toContainText("Updated calculation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "calc")).toMatchObject({
    label: "Updated calculation",
    expression: "6 * 7",
  });
  expect(saved.draft.nodes.filter((node) => node.id !== "calc")).toEqual(
    original.draft.nodes.filter((node) => node.id !== "calc"),
  );
  expect(saved.draft.inputs).toEqual(original.draft.inputs);
  expect(saved.draft.edges).toEqual(original.draft.edges);
  expect(saved.draft.notes).toEqual(original.draft.notes);
  menu = await openMenu(page, "input");
  await expect(
    menu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(card(page, "calc")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(card(page, "input")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const deleted: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(deleted.draft.nodes.map((node) => node.id)).toEqual(["input", "out"]);
  expect(deleted.draft.edges).toEqual([]);
});

test("input modal validates JSON locally and cancel clears only its own buffer", async ({
  page,
  request,
}) => {
  const id = `node-context-input-${Date.now()}`;
  const original = await createRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await card(page, "input").click();
  const sidebar = page.locator(".inspector-sidebar");
  await sidebar.getByLabel("Default JSON (optional)").fill("[");
  let menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(
      "Fix the invalid JSON default before opening another node editor",
    ),
  ).toBeVisible();
  await expect(sidebar.getByLabel("Default JSON (optional)")).toHaveValue("[");
  await sidebar.getByLabel("Default JSON (optional)").fill("[]");
  menu = await openMenu(page, "input");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit node/ });
  await dialog.getByLabel("Default JSON (optional)").fill("[");
  await expect(
    dialog.getByRole("button", { name: "Apply to graph" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sidebar.getByLabel("Default JSON (optional)")).toHaveValue("[]");
  menu = await openMenu(page, "input");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Default JSON (optional)")).toHaveValue("[]");
  await dialog.getByLabel("Default JSON (optional)").fill("[1, 2]");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "Apply to graph" }),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(
    await dialog
      .locator(".inspector-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBeTruthy();
  await dialog.getByRole("button", { name: "Apply to graph" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].defaultValue).toEqual([1, 2]);
  expect(saved.draft.nodes).toEqual(original.draft.nodes);
});

test("historical versions and pending saves disable context mutations", async ({
  page,
  request,
}) => {
  const id = `node-context-guards-${Date.now()}`;
  await createRule(request, id, true);
  await page.goto(`/#/rules/${id}?version=1`);
  let menu = await openMenu(page, "calc");
  await expect(
    menu.getByRole("menuitem", { name: "Edit", exact: true }),
  ).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "Rename", exact: true }),
  ).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.goto(`/#/rules/${id}`);
  await card(page, "calc").click();
  await page.getByLabel("Node name", { exact: true }).fill("Pending save edit");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() === "PUT") {
      saving = true;
      await held;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => saving).toBe(true);
    menu = await openMenu(page, "calc");
    await expect(
      menu.getByRole("menuitem", { name: "Edit", exact: true }),
    ).toBeDisabled();
    await expect(
      menu.getByRole("menuitem", { name: "Rename", exact: true }),
    ).toBeDisabled();
    await expect(
      menu.getByRole("menuitem", { name: "Delete", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expect(card(page, "calc")).toBeVisible();
  } finally {
    release();
  }
});

test("Rename focuses the inline name, targets the clicked node, and preserves unfinished input JSON", async ({
  page,
  request,
}) => {
  const id = `node-context-rename-${Date.now()}`;
  const original = await createRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await card(page, "input").click();
  const sidebar = page.locator(".inspector-sidebar");
  const name = sidebar.getByLabel("Node name", { exact: true });
  await sidebar.getByLabel("Default JSON (optional)").fill("[");
  let menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(
    page.getByText("Fix the invalid JSON default before renaming another node"),
  ).toBeVisible();
  await expect(name).toHaveValue("Inputs");
  await expect(sidebar.getByLabel("Default JSON (optional)")).toHaveValue("[");
  menu = await openMenu(page, "input");
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(name).toBeFocused();
  expect(
    await name.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, "Inputs".length]);
  await page.keyboard.insertText("Renamed inputs");
  await expect(name).toHaveValue("Renamed inputs");
  await expect(sidebar.getByLabel("Default JSON (optional)")).toHaveValue("[");
  await sidebar.getByLabel("Default JSON (optional)").fill("[]");
  menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(name).toHaveValue("Calculate");
  await expect(name).toBeFocused();
  await page.keyboard.insertText("Renamed calculation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.nodes.map((node) => node.label)).toEqual([
    "Renamed inputs",
    "Renamed calculation",
    "Result",
  ]);
  expect(saved.draft.edges).toEqual(original.draft.edges);
  expect(saved.draft.inputs).toEqual(original.draft.inputs);
});
