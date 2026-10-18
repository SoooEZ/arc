import { expect, test, type Page } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRule,
  readRule,
  uniqueId,
} from "./helpers/api";
import { canvasNode } from "./helpers/canvas";

const doubled: Definition = {
  ...inputToOutput,
  nodes: inputToOutput.nodes.map((node) =>
    node.id === "out"
      ? { ...node, label: "Doubled", expression: "amount * 2" }
      : node,
  ),
};

async function saveDraft(
  request: Parameters<typeof readRule>[0],
  rule: Rule,
  definition: Definition,
): Promise<Rule> {
  const response = await request.put(`/api/rules/${rule.id}`, {
    data: {
      name: rule.name,
      description: rule.description,
      revision: rule.revision,
      definition,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Rule;
}

const output = (page: Page) => canvasNode(page, "out");

test("a published version restored to the draft is one undoable edit that Save keeps", async ({
  page,
  request,
}) => {
  let rule = await createRule(request, {
    id: uniqueId("restore"),
    definition: inputToOutput,
  });
  rule = await publishRule(request, rule);
  rule = await saveDraft(request, rule, doubled);
  rule = await publishRule(request, rule);

  // The header says whether the draft is the latest version as published.
  await page.goto(`/#/rules/${rule.id}`);
  await expect(output(page)).toContainText("amount * 2");
  const header = page.locator(".editor-heading");
  await expect(header).toContainText("Published · v2");
  await expect(header).not.toContainText("Unpublished changes");

  await page.goto(`/#/rules/${rule.id}?version=1`);
  await expect(output(page)).toContainText("amount");
  await page
    .getByRole("button", { name: "Restore to draft", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Restore version 1?" });
  await expect(dialog).toContainText("Nothing is saved yet");
  await dialog
    .getByRole("button", { name: "Restore to draft", exact: true })
    .click();

  await expect(page).toHaveURL(new RegExp(`#/rules/${rule.id}$`));
  await expect(
    page.getByText("Version 1 restored to the draft.", { exact: false }),
  ).toBeVisible();
  await expect(output(page)).not.toContainText("amount * 2");
  await expect(output(page)).toContainText("Result");
  await expect(header).toContainText("Unsaved changes");
  await expect(header).toContainText("Unpublished changes");

  // Undo brings the draft back as it was; Redo restores the version again.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(output(page)).toContainText("amount * 2");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(output(page)).toContainText("Result");

  // ⌘/Ctrl S saves wherever the focus is.
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await readRule(request, rule.id);
  const version = (await (
    await request.get(`/api/rules/${rule.id}/versions/1`)
  ).json()) as { definition: Definition };
  expect(saved.draft.nodes.find((node) => node.id === "out")).toEqual(
    version.definition.nodes.find((node) => node.id === "out"),
  );
});

test("an unpublished rule says so, and a publication makes the draft current", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("status"),
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  const header = page.locator(".editor-heading");
  await expect(header).toContainText("Not published");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Publish version 1" })
    .getByRole("button", { name: "Publish v1", exact: true })
    .click();
  await expect(header).toContainText("Published · v1");
  await expect(header).not.toContainText("Unpublished changes");
  await canvasNode(page, "out").click();
  await page.getByLabel("Node name", { exact: true }).fill("Total");
  await expect(header).toContainText("Unpublished changes");
  // Typing the old name back makes the draft the published version again.
  await page.getByLabel("Node name", { exact: true }).fill("Result");
  await expect(header).not.toContainText("Unpublished changes");
});
