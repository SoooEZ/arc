import { setEditorText } from "./helpers/editor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import {
  createRule as createApiRule,
  publishRule,
  uniqueId,
} from "./helpers/api";

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
  const rule: Rule = await createApiRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  if (publish) await publishRule(request, rule);
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
  const id = uniqueId("node-context");
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
  const id = uniqueId("node-context-input");
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
      "Fix the invalid parameter default before opening another node editor",
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
  const id = uniqueId("node-context-guards");
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
  const id = uniqueId("node-context-rename");
  const original = await createRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await card(page, "input").click();
  const sidebar = page.locator(".inspector-sidebar");
  const name = sidebar.getByLabel("Node name", { exact: true });
  await sidebar.getByLabel("Default JSON (optional)").fill("[");
  let menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(
    page.getByText(
      "Fix the invalid parameter default before renaming another node",
    ),
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

test("deleting an unselected node from the context menu keeps the selection", async ({
  page,
  request,
}) => {
  const id = uniqueId("node-context-keep");
  await createRule(request, id);
  await page.goto(`/#/rules/${id}?node=calc`);
  const nodeName = page.getByLabel("Node name", { exact: true });
  await expect(nodeName).toHaveValue("Calculate");
  // The Inspector jumped to Inputs before.
  const menu = await openMenu(page, "out");
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(card(page, "out")).toHaveCount(0);
  await expect(nodeName).toHaveValue("Calculate");
  // Deleting the selected node from the Inspector still selects the Input node.
  await page.getByRole("button", { name: "Delete node", exact: true }).click();
  await expect(card(page, "calc")).toHaveCount(0);
  await expect(nodeName).toHaveValue("Inputs");
});

test("an extra Input node can be deleted while the entry Input stays", async ({
  page,
  request,
}) => {
  const id = uniqueId("node-context-inputs");
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "input2",
        type: "INPUT",
        label: "Stray input",
        position: { x: 550, y: 0 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "1",
        position: { x: 250, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "out" },
      { id: "stray", source: "input2", sourceHandle: "next", target: "out" },
    ],
  };
  await createApiRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}?node=input`);
  const nodeErrors = page.getByRole("button", { name: /^Node errors/ });
  await expect(nodeErrors).toBeVisible();
  // The entry Input has no delete button and a disabled menu action, as before.
  await expect(
    page.getByRole("button", { name: "Delete node", exact: true }),
  ).toHaveCount(0);
  let menu = await openMenu(page, "input");
  await expect(
    menu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  // Every Input was undeletable, so a stray second one kept the graph invalid.
  menu = await openMenu(page, "input2");
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(card(page, "input2")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(nodeErrors).toHaveCount(0);
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.nodes.map((node) => node.id)).toEqual(["input", "out"]);
  expect(saved.draft.edges.map((edge) => edge.id)).toEqual(["start"]);
});

test("deleting the selected node selects the default node, as a build or version load would", async ({
  page,
  request,
}) => {
  const id = uniqueId("node-context-default");
  await createApiRule(request, {
    id,
    definition: {
      schemaVersion: 1,
      inputs: [],
      nodes: [
        {
          id: "input",
          type: "INPUT",
          label: "Inputs",
          position: { x: 250, y: 0 },
        },
        {
          id: "check",
          type: "CONDITION",
          label: "Check",
          expression: "true",
          position: { x: 250, y: 180 },
        },
        {
          id: "out",
          type: "OUTPUT",
          label: "Result",
          expression: "1",
          position: { x: 250, y: 360 },
        },
      ],
      edges: [
        { id: "a", source: "input", sourceHandle: "next", target: "check" },
        { id: "b", source: "check", sourceHandle: "true", target: "out" },
      ],
    },
  });
  await page.goto(`/#/rules/${id}?node=out`);
  const nodeName = page.getByLabel("Node name", { exact: true });
  await expect(nodeName).toHaveValue("Result");
  const menu = await openMenu(page, "out");
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(card(page, "out")).toHaveCount(0);
  // The default node is the first Condition, not the Input.
  await expect(nodeName).toHaveValue("Check");
});

test("a node dialog with staged edits asks before the browser leaves the rule", async ({
  page,
  request,
}) => {
  const id = uniqueId("node-context-staged");
  await createRule(request, id);
  await page.goto("/#/library");
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}`;
  }, id);
  const menu = await openMenu(page, "calc");
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit node/ });
  await dialog.getByLabel("Node name", { exact: true }).fill("Staged name");
  const prompts: string[] = [];
  page.on("dialog", (prompt) => {
    prompts.push(prompt.message());
    void prompt.dismiss();
  });
  // Back used to leave for the library and drop the staged edits without a word.
  await page.goBack();
  await expect
    .poll(() => prompts)
    .toEqual([
      "Discard the edits in this dialog? They are not applied to the draft yet.",
    ]);
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
  await expect(dialog.getByLabel("Node name", { exact: true })).toHaveValue(
    "Staged name",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  expect(prompts).toHaveLength(1);
});
