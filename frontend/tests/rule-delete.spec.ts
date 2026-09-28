import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import {
  createRule as createApiRule,
  deleteRule,
  publishRule,
  uniqueId,
  uniqueStamp,
} from "./helpers/api";

const createRule = (
  request: APIRequestContext,
  id: string,
  definition?: Definition,
) => createApiRule(request, { id, name: `Delete ${id}`, definition });

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
  const id = uniqueId("delete-draft");
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

  // Back returns to the deleted rule's route: not found, with no retry to offer.
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Rule not found", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry rule", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/library$/);
});

/** Holds the DELETE response until released; the server has already acted. */
async function holdDeletion(page: Page, id: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === `/api/rules/${id}`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  return release;
}

test("a deletion outlives the editor: leaving during it still reports and forgets the rule", async ({
  page,
  request,
}) => {
  const id = uniqueId("delete-leave");
  await createRule(request, id);
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  const release = await holdDeletion(page, id);
  await page.goto("/#/library");
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}`;
  }, id);
  const dialog = await openDeletion(page);
  await dialog
    .getByRole("button", { name: "Delete rule", exact: true })
    .click();
  await expect(dialog.getByText("Deleting…")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  expect(prompts).toEqual([]);

  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" && response.url().includes(id),
  );
  release();
  await answered;
  await expect(page.getByText(`Rule ${id} deleted`)).toBeVisible();
  await expect(page.locator(".rule-card").filter({ hasText: id })).toHaveCount(
    0,
  );
  expect((await request.get(`/api/rules/${id}`)).status()).toBe(404);
  // Code studio no longer targets the deleted rule.
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: "Code studio", exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`/studio/${id}`));
});

async function callee(request: APIRequestContext, id: string) {
  const rule = await createRule(request, id);
  const published = await publishRule(request, rule);
  return published;
}

function callerOf(calleeId: string): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "callee",
        type: "REFERENCE",
        label: "Callee",
        position: { x: 0, y: 160 },
        ruleId: calleeId,
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
  };
}

test("a pending deletion keeps its dialog open, and a refusal lists every caller", async ({
  page,
  request,
}) => {
  const stamp = uniqueStamp();
  const called = await callee(request, `delete-called-${stamp}`);
  const callers: string[] = [];
  for (let index = 0; index < 7; index++) {
    const caller = await createRule(
      request,
      `delete-caller-${index}-${stamp}`,
      callerOf(called.id),
    );
    callers.push(caller.id);
  }
  const release = await holdDeletion(page, called.id);
  await page.goto(`/#/rules/${called.id}`);
  const dialog = await openDeletion(page);
  await dialog.getByLabel(`Type ${called.id} to confirm`).fill(called.id);
  await dialog
    .getByRole("button", { name: "Delete rule", exact: true })
    .click();
  await expect(dialog.getByText("Deleting…")).toBeVisible();
  // Nothing closes the dialog while the outcome is pending.
  await page.keyboard.press("Escape");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Keep rule", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();

  release();
  await expect(
    dialog.getByText(
      `Other rules call this rule: ${callers
        .slice(0, 5)
        .map((id) => `${id} (draft)`)
        .join(", ")} and 2 more. Remove those calls before deleting it.`,
    ),
  ).toBeVisible();
  const listed = dialog.getByRole("list", { name: "Rules calling this rule" });
  await expect(listed.getByRole("listitem")).toHaveCount(7);
  await expect(listed).toContainText(`${callers[6]} (draft)`);

  for (const caller of callers) await deleteRule(request, caller);
  await deleteRule(request, called.id);
});

test("a refusal that arrives after leaving is reported in the workspace", async ({
  page,
  request,
}) => {
  const stamp = uniqueStamp();
  const called = await callee(request, `delete-late-${stamp}`);
  const caller = await createRule(
    request,
    `delete-late-caller-${stamp}`,
    callerOf(called.id),
  );
  const release = await holdDeletion(page, called.id);
  await page.goto("/#/library");
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}`;
  }, called.id);
  const dialog = await openDeletion(page);
  await dialog.getByLabel(`Type ${called.id} to confirm`).fill(called.id);
  await dialog
    .getByRole("button", { name: "Delete rule", exact: true })
    .click();
  await expect(dialog.getByText("Deleting…")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);

  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().includes(called.id),
  );
  release();
  await answered;
  await expect(
    page.getByText(
      `Rule ${called.id} was not deleted: Other rules call this rule: ${caller.id} (draft). Remove those calls before deleting it.`,
    ),
  ).toBeVisible();
  expect((await request.get(`/api/rules/${called.id}`)).ok()).toBeTruthy();
  await deleteRule(request, caller.id);
  await deleteRule(request, called.id);
});

test("a rule published elsewhere is not deleted behind a draft-only confirmation", async ({
  page,
  request,
}) => {
  const id = uniqueId("delete-stale");
  const rule = await createRule(request, id);
  await page.goto(`/#/rules/${id}`);
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  // Published from another tab while this editor still shows an unpublished draft.
  await publishRule(request, rule);
  await page.getByRole("button", { name: "Delete rule…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Deleting removes this draft. This cannot be undone.",
  );
  await dialog
    .getByRole("button", { name: "Delete rule", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "This rule changed in another editor. Reload it before saving, publishing or deleting.",
    ),
  ).toBeVisible();
  expect((await request.get(`/api/rules/${id}/versions/1`)).ok()).toBeTruthy();
  await deleteRule(request, id);
});

test("a published rule asks for its ID, and a rule that another rule calls is kept", async ({
  page,
  request,
}) => {
  const callee = await createRule(request, uniqueId("delete-callee"));
  await publishRule(request, callee);
  const caller = await createRule(request, uniqueId("delete-caller"), {
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

  await deleteRule(request, caller.id);
  await deleteRule(request, callee.id);
});
