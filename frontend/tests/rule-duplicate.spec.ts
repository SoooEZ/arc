import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule, TestCase } from "../src/types";
import {
  createRule,
  deleteRule,
  inputToOutput,
  publishRule,
  readRule,
  uniqueStamp,
} from "./helpers/api";
import { canvasNode } from "./helpers/canvas";

/** inputToOutput returning amount * 2 instead: the saved draft after v1. */
const doubled: Definition = {
  ...inputToOutput,
  nodes: inputToOutput.nodes.map((node) =>
    node.id === "out" ? { ...node, expression: "amount * 2" } : node,
  ),
};

/** A published rule (v1 returns amount) whose saved draft doubles it, with one saved test. */
async function original(request: APIRequestContext) {
  const stamp = uniqueStamp();
  let rule = await createRule(request, {
    id: `dup-${stamp}`,
    name: `Dup ${stamp}`,
    kind: "DECISION_TREE",
    description: "Copied in tests.",
    definition: inputToOutput,
  });
  rule = await publishRule(request, rule);
  const saved = await request.put(`/api/rules/${rule.id}`, {
    data: {
      name: rule.name,
      description: rule.description,
      revision: rule.revision,
      definition: doubled,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const test = await request.post(`/api/rules/${rule.id}/test-cases`, {
    data: { name: "Ten doubled", inputs: { amount: 10 }, expectedResult: 20 },
  });
  expect(test.status(), await test.text()).toBe(201);
  return (await saved.json()) as Rule;
}

async function testCases(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/rules/${id}/test-cases`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as TestCase[];
}

/** The library card's More actions menu, found by a search for the rule. */
async function cardActions(page: Page, rule: Rule) {
  await page.goto("/#/library");
  await page.getByLabel("Search rules", { exact: true }).fill(rule.name);
  await expect(page.locator(".rule-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: `More actions: ${rule.name}`, exact: true })
    .click();
  return page.getByRole("menu", { name: `Actions for ${rule.name}` });
}

test("a card's Duplicate copies the saved draft and the saved tests into a new unpublished rule", async ({
  page,
  request,
}) => {
  const rule = await original(request);
  const copyId = `${rule.id}-copy`;
  await (
    await cardActions(page, rule)
  )
    .getByRole("menuitem", { name: "Duplicate…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Duplicate rule" });
  await expect(dialog.getByLabel("Rule name", { exact: true })).toHaveValue(
    `${rule.name} (copy)`,
  );
  await expect(dialog.getByLabel("Rule ID", { exact: true })).toHaveValue(
    copyId,
  );
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Copied in tests.",
  );
  await expect(dialog.getByLabel("Copy from", { exact: true })).toHaveValue(
    "Saved draft",
  );
  await expect(
    dialog.getByRole("checkbox", { name: "Copy saved tests" }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Duplicate rule", exact: true })
    .click();

  await expect(page).toHaveURL(new RegExp(`#/rules/${copyId}$`));
  await expect(page.getByText(`Copied from ${rule.name}.`)).toBeVisible();
  const copy = await readRule(request, copyId);
  expect(copy).toMatchObject({
    name: `${rule.name} (copy)`,
    kind: "DECISION_TREE",
    description: "Copied in tests.",
    publishedVersion: null,
  });
  expect(copy.draft.nodes.find((node) => node.id === "out")?.expression).toBe(
    "amount * 2",
  );
  expect(await testCases(request, copyId)).toEqual([
    expect.objectContaining({
      name: "Ten doubled",
      inputs: { amount: 10 },
      expectedResult: 20,
      expectedError: null,
    }),
  ]);
  // The original keeps its draft, version and tests.
  expect((await readRule(request, rule.id)).revision).toBe(rule.revision);
  expect(await testCases(request, rule.id)).toHaveLength(1);
  await deleteRule(request, copyId);
  await deleteRule(request, rule.id);
});

test("Duplicate copies a published version without the tests, and a taken ID keeps the dialog open", async ({
  page,
  request,
}) => {
  const rule = await original(request);
  const copyId = `${rule.id}-v1`;
  await (
    await cardActions(page, rule)
  )
    .getByRole("menuitem", { name: "Duplicate…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Duplicate rule" });
  // The original's own ID is taken: the server's reason shows in the dialog.
  await dialog.getByLabel("Rule ID", { exact: true }).fill(rule.id);
  await dialog
    .getByRole("button", { name: "Duplicate rule", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");

  await dialog.getByLabel("Rule ID", { exact: true }).fill(copyId);
  await dialog.getByLabel("Copy from", { exact: true }).click();
  await page.getByRole("option", { name: "Version 1 · latest" }).click();
  await dialog.getByRole("checkbox", { name: "Copy saved tests" }).uncheck();
  await dialog
    .getByRole("button", { name: "Duplicate rule", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/rules/${copyId}$`));
  await expect(
    page.getByText(`Copied from ${rule.name} version 1.`),
  ).toBeVisible();
  const copy = await readRule(request, copyId);
  expect(copy.draft.nodes.find((node) => node.id === "out")?.expression).toBe(
    "amount",
  );
  expect(await testCases(request, copyId)).toEqual([]);
  await deleteRule(request, copyId);
  await deleteRule(request, rule.id);
});

test("a card exports its draft and opens in Code studio", async ({
  page,
  request,
}) => {
  const rule = await original(request);
  // The download's text, read from its object URL as the link is clicked.
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      click.call(this);
      void fetch(this.href)
        .then((response) => response.text())
        .then((text) => Object.assign(window, { exportedText: text }));
    };
  });
  const download = page.waitForEvent("download");
  await (
    await cardActions(page, rule)
  )
    .getByRole("menuitem", { name: "Export draft JSON" })
    .click();
  expect((await download).suggestedFilename()).toBe(`${rule.id}-draft.json`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as { exportedText?: string }).exportedText),
    )
    .toBeDefined();
  const exported = JSON.parse(
    await page.evaluate(
      () => (window as { exportedText?: string }).exportedText!,
    ),
  ) as Definition;
  expect(exported.nodes.map((node) => node.expression ?? null)).toEqual([
    null,
    "amount * 2",
  ]);

  await (
    await cardActions(page, rule)
  )
    .getByRole("menuitem", { name: "Open in Code studio" })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/studio/${rule.id}$`));
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await deleteRule(request, rule.id);
});

test("rule settings duplicate the saved draft, saying that unsaved changes stay behind", async ({
  page,
  request,
}) => {
  const rule = await original(request);
  const copyId = `${rule.id}-settings`;
  await page.goto(`/#/rules/${rule.id}`);
  // An unsaved edit is not part of the copy.
  await canvasNode(page, "out").click();
  await page.getByLabel("Node name", { exact: true }).fill("Unsaved name");
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Rule settings" })
    .getByRole("button", { name: "Duplicate rule…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Duplicate rule" });
  await expect(dialog).toContainText(
    "The copy starts from the saved draft: unsaved changes stay in this draft.",
  );
  await dialog.getByLabel("Rule ID", { exact: true }).fill(copyId);
  // Leaving asks about the unsaved edit; staying keeps the original open.
  page.once("dialog", (confirm) => void confirm.dismiss());
  await dialog
    .getByRole("button", { name: "Duplicate rule", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/rules/${rule.id}$`));
  await page
    .getByRole("dialog", { name: "Rule settings" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Unsaved name",
  );
  const copy = await readRule(request, copyId);
  expect(copy.draft.nodes.find((node) => node.id === "out")?.label).toBe(
    "Result",
  );
  // The copy is listed, and opens once the edit is saved.
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.goto("/#/library");
  await page.getByLabel("Search rules", { exact: true }).fill(copy.name);
  await expect(page.locator(".rule-card")).toHaveCount(1);
  await deleteRule(request, copyId);
  await deleteRule(request, rule.id);
});
