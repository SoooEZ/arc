import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";

/*
 * Every editor control reads one capability set from the rule document. These
 * workflows pin what each control allows for an editable draft, while a save is
 * pending, and for a published version.
 */

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 250, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calculate",
      expression: "amount * 2",
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

async function createPublishedRule(request: APIRequestContext, id: string) {
  const created = await request.post("/api/rules", {
    data: { id, name: "Capability fixture", kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  const rule: Rule = await created.json();
  const published = await request.post(`/api/rules/${id}/publish`, {
    data: { revision: rule.revision },
  });
  expect(published.ok()).toBeTruthy();
}

type ControlState = "enabled" | "disabled" | "absent";

async function expectButtons(
  page: Page,
  expected: Record<string, ControlState>,
) {
  for (const [name, state] of Object.entries(expected)) {
    const button = page.getByRole("button", { name, exact: true });
    if (state === "absent") await expect(button, name).toHaveCount(0);
    else if (state === "enabled") await expect(button, name).toBeEnabled();
    else await expect(button, name).toBeDisabled();
  }
}

const node = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

/** Cards move only while the draft is editable (React Flow marks them draggable). */
async function expectCanvasEditable(page: Page, editable: boolean) {
  const card = expect(node(page, "calc"));
  if (editable) await card.toHaveClass(/\bdraggable\b/);
  else await card.not.toHaveClass(/\bdraggable\b/);
}

test("a draft allows editing and commands until a save holds the document", async ({
  page,
  request,
}) => {
  const id = `capabilities-draft-${Date.now()}`;
  await createPublishedRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await node(page, "calc").locator(".graph-node").click();
  const name = page.getByLabel("Node name", { exact: true });
  await expect(name).toHaveValue("Calculate");
  await expectButtons(page, {
    "Rule settings": "enabled",
    "Code editor": "enabled",
    "Test rule": "enabled",
    "Save draft": "disabled",
    Publish: "enabled",
    "Edit draft": "absent",
    "Arrange graph": "enabled",
    Validate: "enabled",
    "Add node": "enabled",
  });
  await expect(name).toBeEnabled();
  await expectCanvasEditable(page, true);

  await name.fill("Calculate twice");
  await expectButtons(page, { "Save draft": "enabled" });

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
    await expectButtons(page, {
      "Rule settings": "disabled",
      "Code editor": "disabled",
      "Test rule": "disabled",
      "Saving…": "disabled",
      Publish: "disabled",
      "Arrange graph": "disabled",
      Validate: "disabled",
      "Add node": "disabled",
    });
    await expect(name).toBeDisabled();
    await expectCanvasEditable(page, false);
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expectButtons(page, {
      "Save draft": "disabled",
      Publish: "enabled",
      "Add node": "enabled",
    });
    await expect(name).toBeEnabled();
    await expectCanvasEditable(page, true);
  } finally {
    release();
  }
});

test("a published version offers commands that keep it unchanged", async ({
  page,
  request,
}) => {
  const id = `capabilities-version-${Date.now()}`;
  await createPublishedRule(request, id);
  const writes: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.url().includes(`/api/rules/${id}`) &&
      ["PUT", "POST"].includes(outgoing.method())
    )
      writes.push(`${outgoing.method()} ${outgoing.url()}`);
  });
  await page.goto(`/#/rules/${id}?version=1`);
  await expect(page.getByText("Immutable published version")).toBeVisible();
  await node(page, "calc").locator(".graph-node").click();
  await expectButtons(page, {
    "Rule settings": "enabled",
    "Code editor": "enabled",
    "Test rule": "enabled",
    "Save draft": "absent",
    Publish: "absent",
    "Edit draft": "enabled",
    "Arrange graph": "disabled",
    Validate: "enabled",
    "Add node": "absent",
  });
  await expect(page.getByLabel("Node name", { exact: true })).toBeDisabled();
  await expectCanvasEditable(page, false);

  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Rule settings" });
  await expect(settings.getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(
    settings.getByRole("button", { name: "Apply changes", exact: true }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toHaveCount(0);

  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(
    page.getByText("Graph is valid. All paths lead to a result."),
  ).toBeVisible();
  expect(writes).toEqual([]);
});
