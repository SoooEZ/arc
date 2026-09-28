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
  definition?: Definition,
): Promise<Rule> {
  const response = await request.post("/api/rules", {
    data: { id, name: `Delete ${id}`, kind: "FORMULA", definition },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Rule;
}

async function openDeletion(page: Page) {
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete rule…", exact: true }).click();
  return page.getByRole("dialog");
}

test("deleting a draft leaves for the library without asking about its unsaved changes", async ({
  page,
  request,
}) => {
  const id = `delete-draft-${Date.now()}`;
  await createRule(request, id);
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`/#/rules/${id}`);
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Renamed");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();

  const dialog = await openDeletion(page);
  await expect(dialog.getByRole("alert")).toHaveText(
    "Deleting removes this draft. This cannot be undone.",
  );
  await dialog
    .getByRole("button", { name: "Delete rule", exact: true })
    .click();

  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByText(`Rule ${id} deleted`)).toBeVisible();
  expect(prompts).toEqual([]);
  expect((await request.get(`/api/rules/${id}`)).status()).toBe(404);
});

test("a published rule asks for its ID, and a rule that another rule calls is kept", async ({
  page,
  request,
}) => {
  const callee = await createRule(request, `delete-callee-${Date.now()}`);
  const published = await request.post(`/api/rules/${callee.id}/publish`, {
    data: { revision: callee.revision },
  });
  expect(published.ok(), await published.text()).toBeTruthy();
  const caller = await createRule(request, `delete-caller-${Date.now()}`, {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "callee",
        type: "REFERENCE",
        label: "Callee",
        position: { x: 0, y: 160 },
        ruleId: callee.id,
        version: 1,
        bindings: {},
        output: "total",
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        position: { x: 0, y: 320 },
        expression: "total",
      },
    ],
    edges: [
      {
        id: "to-callee",
        source: "input",
        target: "callee",
        sourceHandle: "next",
      },
      { id: "to-out", source: "callee", target: "out", sourceHandle: "next" },
    ],
  });

  await page.goto(`/#/rules/${callee.id}`);
  const dialog = await openDeletion(page);
  await expect(dialog.getByRole("alert")).toHaveText(
    `Deleting removes the draft and version 1. API calls to ${callee.id} will fail. This cannot be undone.`,
  );
  const confirm = dialog.getByRole("button", {
    name: "Delete rule",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Type ${callee.id} to confirm`).fill(callee.id);
  await confirm.click();

  await expect(
    dialog.getByText(
      `Other rules call this rule: ${caller.id} (draft). Remove those calls before deleting it.`,
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/rules/${callee.id}$`));
  expect((await request.get(`/api/rules/${callee.id}`)).ok()).toBeTruthy();

  expect((await request.delete(`/api/rules/${caller.id}`)).status()).toBe(204);
  expect((await request.delete(`/api/rules/${callee.id}`)).status()).toBe(204);
});
