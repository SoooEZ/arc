import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "payload", type: "ARRAY", required: false, defaultValue: [] },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "42",
      position: { x: 200, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

test("unfinished defaults survive canvas, outline, node-code and sidebar view changes", async ({
  page,
  request,
}) => {
  const id = uniqueId("buffer-guards");
  await createRule(request, {
    id,
    name: "Buffer guards",
    kind: "FORMULA",
    definition,
  });
  const writes: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "PUT") writes.push(sent.url());
  });
  await page.goto(`/#/rules/${id}`);
  const field = page.getByLabel("Default JSON (optional)", { exact: true });
  const name = page.getByLabel("Node name", { exact: true });
  await field.fill("[");
  await page.locator('.react-flow__node[data-id="out"] .graph-node').click();
  await expect(name).toHaveValue("Inputs");
  await expect(field).toHaveValue("[");
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Result/ })
    .click();
  await expect(name).toHaveValue("Inputs");
  await expect(field).toHaveValue("[");
  await page
    .getByRole("button", { name: "Close outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Node expression · Result", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(field).toHaveValue("[");
  await page
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(field).toHaveValue("[");
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const blockedView = page
    .getByRole("alert")
    .filter({ hasText: "before changing views" });
  await expect(blockedView).toBeVisible();
  await blockedView.getByRole("button").click();
  const cdp = await page.context().newCDPSession(page);
  const position = async () => {
    const history = await cdp.send("Page.getNavigationHistory");
    return {
      index: history.currentIndex,
      hash: new URL(history.entries[history.currentIndex].url).hash,
    };
  };
  const before = await position();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Code studio", exact: true })
    .click();
  await expect(blockedView).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
  // The bounce undoes the pushed entry instead of pushing the graph route again,
  // so the session is back at the entry it showed before the click.
  await expect.poll(position).toEqual(before);
  expect(before.hash).toBe(`#/rules/${id}`);
  await cdp.detach();
  await expect(field).toHaveValue("[");
  await expect(name).toHaveValue("Inputs");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "before saving or changing views",
  );
  expect(writes).toEqual([]);
  await field.fill("[1, 2]");
  await page
    .getByRole("button", { name: "Node expression · Result", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Result",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('.react-flow__node[data-id="out"] .graph-node').click();
  await expect(name).toHaveValue("Result");
  await page.locator('.react-flow__node[data-id="input"] .graph-node').click();
  expect(JSON.parse(await field.inputValue())).toEqual([1, 2]);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].defaultValue).toEqual([1, 2]);
});

test("a draft's last non-Input node cannot be deleted from either entry point", async ({
  page,
  request,
}) => {
  const id = uniqueId("last-node");
  await createRule(request, {
    id,
    name: "Last node",
    kind: "FORMULA",
    definition: {
      ...definition,
      inputs: [],
      nodes: [definition.nodes[1]],
      edges: [],
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/#/rules/${id}`);
  const node = page.locator('.react-flow__node[data-id="out"] .graph-node');
  await expect(
    page.getByRole("button", { name: "Delete node", exact: true }),
  ).toBeDisabled();
  await node.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Result",
  );
  await page.getByLabel("Node name", { exact: true }).fill("Still editable");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.nodes).toHaveLength(1);
  expect(saved.draft.nodes[0].label).toBe("Still editable");
  expect(errors).toEqual([]);
});

test("opening node code locks defaults while its editor module is loading", async ({
  page,
  request,
}) => {
  const id = uniqueId("node-code-loading");
  await createRule(request, {
    id,
    name: "Node code loading",
    kind: "FORMULA",
    definition,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(
    /\/NodeExpressionDialog[^/]*\.(tsx|js)(\?.*)?$/,
    async (route) => {
      held = true;
      await gate;
      await route.continue();
    },
  );
  try {
    await page.goto(`/#/rules/${id}`);
    const field = page.getByLabel("Default JSON (optional)", { exact: true });
    await expect(field).toBeEnabled();
    await page
      .getByRole("button", { name: "Node expression · Result", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue("[]");
    release();
    const dialog = page.getByRole("dialog", {
      name: "Node expression · Result",
      exact: true,
    });
    const editor = dialog.getByRole("textbox", {
      name: "Node code editor",
      exact: true,
    });
    await setEditorText(
      page,
      editor,
      'node out OUTPUT "Result" at (200, 200) { return 43; }',
    );
    await dialog
      .getByRole("button", { name: "Apply to graph", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue("[]");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs[0].defaultValue).toEqual([]);
    expect(
      saved.draft.nodes.find((node) => node.id === "out")?.expression,
    ).toBe("43");
  } finally {
    release();
  }
});

test("adding a node is refused whole while a parameter default is invalid", async ({
  page,
  request,
}) => {
  const id = uniqueId("buffer-guards-add");
  await createRule(request, {
    id,
    name: "Buffer guards add",
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}`);
  const field = page.getByLabel("Default JSON (optional)", { exact: true });
  await field.fill("[");
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Formula", exact: true }).click();
  // The command is refused before it edits: no node appears, and the message says why.
  await expect(
    page.getByRole("alert").filter({ hasText: "before adding a node" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(field).toHaveValue("[");
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Inputs",
  );
});

// Escape and a backdrop click discarded a dialog's staged edits without
// asking, and Rule settings guarded nothing, not even a route change.
test("edits a dialog has not applied are discarded only after confirming", async ({
  page,
  request,
}) => {
  const id = uniqueId("dialog-guards");
  await createRule(request, {
    id,
    name: "Dialog guards",
    kind: "FORMULA",
    definition: {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "out" ? { ...node, expression: "$COUNT(payload)" } : node,
      ),
    },
  });
  const warning =
    "Discard the edits in this dialog? They are not applied to the draft yet.";
  const prompts: string[] = [];
  let discard = false;
  page.on("dialog", async (prompt) => {
    prompts.push(prompt.message());
    await (discard ? prompt.accept() : prompt.dismiss());
  });
  await page.goto(`/#/rules/${id}?node=out`);
  const openEditor = page.getByRole("button", {
    name: "Open in Editor · Return value",
    exact: true,
  });
  const expressionDialog = page.getByRole("dialog", {
    name: "Expression editor · Return value",
    exact: true,
  });
  const code = expressionDialog.getByLabel("Expression code editor", {
    exact: true,
  });
  // An untouched dialog closes at once.
  await openEditor.click();
  await expect(editorLines(code)).toHaveText("$COUNT(payload)");
  await page.keyboard.press("Escape");
  await expect(expressionDialog).toHaveCount(0);
  expect(prompts).toEqual([]);

  await openEditor.click();
  await setEditorText(page, code, "$COUNT(payload) + 1");
  await expressionDialog.getByRole("heading").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => prompts).toEqual([warning]);
  await expect(expressionDialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect.poll(() => prompts).toEqual([warning, warning]);
  await expect(editorLines(code)).toHaveText("$COUNT(payload) + 1");
  discard = true;
  await page.keyboard.press("Escape");
  await expect(expressionDialog).toHaveCount(0);
  await openEditor.click();
  await expect(editorLines(code)).toHaveText("$COUNT(payload)");
  await expressionDialog.getByRole("button", { name: "Cancel" }).click();

  discard = false;
  prompts.length = 0;
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Rule settings" });
  await settings.getByLabel("Name", { exact: true }).fill("Renamed");
  await page.keyboard.press("Escape");
  await expect.poll(() => prompts).toEqual([warning]);
  await expect(settings).toBeVisible();
  // A route change while the modal is open, as a link or Back makes one.
  await page.evaluate(() => {
    location.hash = "#/library";
  });
  await expect.poll(() => prompts).toEqual([warning, warning]);
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}`));
  await expect(settings.getByLabel("Name", { exact: true })).toHaveValue(
    "Renamed",
  );
  discard = true;
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Dialog guards", exact: true }),
  ).toBeVisible();
});
