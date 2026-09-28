import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 200, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

async function createRule(request: APIRequestContext, prefix: string) {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  return id;
}

/** The hash of every session history entry and the current position. */
async function sessionHistory(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const history = await cdp.send("Page.getNavigationHistory");
  await cdp.detach();
  return {
    entries: history.entries.map((entry) => new URL(entry.url).hash),
    index: history.currentIndex,
  };
}

async function openDirtyRule(page: Page, id: string) {
  await page.goto("/#/library");
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  // A link-style hash change, as a bookmark or the address bar would make.
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}?node=input`;
  }, id);
  const nodeName = page.getByLabel("Node name", { exact: true });
  await nodeName.fill("Inputs edited");
  return nodeName;
}

test("cancelling a leave prompt keeps the browser history and the draft", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "history-cancel");
  const nodeName = await openDirtyRule(page, id);
  const ruleUrl = new RegExp(`#/rules/${id}\\?node=input$`);
  const before = await sessionHistory(page);
  expect(before.entries.slice(-2)).toEqual([
    "#/library",
    `#/rules/${id}?node=input`,
  ]);

  // Browser Back already moved to #/library before the prompt; Cancel moves forward again.
  const back = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  await (await back).dismiss();
  await expect.poll(() => sessionHistory(page)).toEqual(before);
  await expect(page).toHaveURL(ruleUrl);
  await expect(nodeName).toHaveValue("Inputs edited");

  // An in-app link asks before the browser moves, so no entry is added.
  const prompts: string[] = [];
  page.once("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "API playground", exact: true })
    .click();
  expect(prompts).toEqual([expect.stringContaining("Leave this rule")]);
  expect(await sessionHistory(page)).toEqual(before);
  await expect(nodeName).toHaveValue("Inputs edited");

  // A typed URL is a new entry; cancelling returns to the rule's own entry.
  const typed = page.waitForEvent("dialog");
  await page.evaluate(() => {
    window.location.hash = "/docs";
  });
  await (await typed).dismiss();
  await expect(page).toHaveURL(ruleUrl);
  await expect
    .poll(async () => (await sessionHistory(page)).index)
    .toBe(before.index);
  await expect(nodeName).toHaveValue("Inputs edited");

  // Back still reaches the library, which the old rewrite had replaced.
  const leave = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  await (await leave).accept();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  expect((await sessionHistory(page)).index).toBe(before.index - 1);
});

test("the embedded source manager guards Back, view switches and unloading", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "manager-guard");
  const sourceName = `Guarded provider ${id}`;
  const createdSource = await request.post("/api/sources", {
    data: {
      id: `src-${id}`,
      name: sourceName,
      definition: {
        kind: "LOOKUP",
        parameters: [
          { name: "key", type: "STRING", required: true, defaultValue: null },
        ],
        entries: { US: 1 },
        timeoutMs: 3000,
      },
    },
  });
  expect(createdSource.ok()).toBeTruthy();
  await page.goto("/#/library");
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}?node=input`;
  }, id);
  await page
    .locator(".input-schema-card")
    .first()
    .getByRole("button", { name: "Manage data sources", exact: true })
    .click();
  const manager = page.getByRole("dialog", {
    name: "Manage data sources",
    exact: true,
  });
  await manager.getByLabel("Search data sources").fill(sourceName);
  await manager
    .locator(".source-list > button")
    .filter({ hasText: sourceName })
    .click();
  const name = manager.getByLabel("Name", { exact: true });
  await name.fill("Unsaved provider name");
  const before = await sessionHistory(page);

  // The rule itself is clean; only the source manager has unsaved work.
  const back = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const prompt = await back;
  expect(prompt.message()).toBe("Discard unsaved data source changes?");
  await prompt.dismiss();
  await expect.poll(() => sessionHistory(page)).toEqual(before);
  await expect(manager).toBeVisible();
  await expect(name).toHaveValue("Unsaved provider name");

  // Code view replaces the inspector, so the same rule's view switch asks too.
  const code = page.waitForEvent("dialog");
  await page.evaluate((ruleId) => {
    window.location.hash = `/studio/${ruleId}`;
  }, id);
  await (await code).dismiss();
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}\\?node=input$`));
  await expect(name).toHaveValue("Unsaved provider name");

  // The workspace, not the dialog, now owns the unload guard.
  const unloadPrompts: string[] = [];
  page.on("dialog", (dialog) => {
    unloadPrompts.push(dialog.type());
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => unloadPrompts).toEqual(["beforeunload"]);
});

test("leaving asks while a source save is still running", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "manager-saving");
  const sourceId = `src-${id}`;
  const createdSource = await request.post("/api/sources", {
    data: {
      id: sourceId,
      name: `Saving provider ${id}`,
      definition: {
        kind: "LOOKUP",
        parameters: [
          { name: "key", type: "STRING", required: true, defaultValue: null },
        ],
        entries: { US: 1 },
        timeoutMs: 3000,
      },
    },
  });
  expect(createdSource.ok()).toBeTruthy();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(`**/api/sources/${sourceId}`, async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/#/library");
    await page.evaluate((ruleId) => {
      window.location.hash = `/rules/${ruleId}?node=input`;
    }, id);
    await page
      .locator(".input-schema-card")
      .first()
      .getByRole("button", { name: "Manage data sources", exact: true })
      .click();
    const manager = page.getByRole("dialog", {
      name: "Manage data sources",
      exact: true,
    });
    await manager
      .getByLabel("Search data sources")
      .fill(`Saving provider ${id}`);
    await manager
      .locator(".source-list > button")
      .filter({ hasText: `Saving provider ${id}` })
      .click();
    await manager.getByLabel("Name", { exact: true }).fill("Saved later");
    await manager
      .getByRole("button", { name: "Save new version", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);

    // The modal covers the workspace links; browser Back still leaves.
    const leaving = page.waitForEvent("dialog");
    await page.evaluate(() => history.back());
    const prompt = await leaving;
    expect(prompt.message()).toContain("still being saved");
    await prompt.dismiss();
    await expect(page).toHaveURL(new RegExp(`#/rules/${id}\\?node=input$`));
    await expect(manager).toBeVisible();
    release();
    await expect(
      manager.getByRole("button", { name: "Close data sources", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});

test("a pending draft save guards leaving the rule but not its graph/code switch", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "draft-saving");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() === "PUT") {
      held = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await openDirtyRule(page, id);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => held).toBe(true);

    // Leaving closes the editor, which would cancel the save.
    const leaving = page.waitForEvent("dialog");
    await page.evaluate(() => history.back());
    const prompt = await leaving;
    expect(prompt.message()).toContain("still being saved");
    await prompt.dismiss();
    await expect(page).toHaveURL(new RegExp(`#/rules/${id}\\?node=input$`));

    // The code view keeps the same editor, so its save simply continues.
    const prompts: string[] = [];
    page.on("dialog", (dialog) => {
      prompts.push(dialog.message());
      void dialog.dismiss();
    });
    await page.evaluate((ruleId) => {
      window.location.hash = `/studio/${ruleId}`;
    }, id);
    await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    expect(prompts).toEqual([]);
    const saved = (await (await request.get(`/api/rules/${id}`)).json()) as {
      draft: Definition;
    };
    expect(saved.draft.nodes[0].label).toBe("Inputs edited");
  } finally {
    release();
  }
});
