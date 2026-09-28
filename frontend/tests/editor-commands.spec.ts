import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 300, y: 0 } },
    {
      id: "calculate",
      type: "FORMULA",
      label: "Calculation",
      expression: "amount * 2",
      output: "total",
      position: { x: 40, y: 420 },
    },
    {
      id: "output",
      type: "OUTPUT",
      label: "Result",
      expression: "total",
      position: { x: 620, y: 160 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "calculate", sourceHandle: "next" },
    { id: "b", source: "calculate", target: "output", sourceHandle: "next" },
  ],
};

async function createRule(request: APIRequestContext, prefix: string) {
  const id = `${prefix}-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: `Commands ${id}`, kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  return id;
}

async function readRule(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/rules/${id}`)).json()) as Rule;
}

/** Holds the first matching request until released; reports whether the page aborted it. */
async function holdRequest(page: Page, url: string, method: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: false, aborted: false, settled: false };
  page.on("requestfailed", (failed) => {
    if (failed.url().endsWith(url) && failed.method() === method)
      state.aborted = true;
  });
  await page.route(`**${url}`, async (route) => {
    if (route.request().method() !== method || state.held) {
      await route.fallback();
      return;
    }
    state.held = true;
    await gate;
    // An aborted request can no longer reach the server.
    await route.continue().catch(() => {});
    state.settled = true;
  });
  return { state, release };
}

for (const step of ["validate", "save", "publish"] as const) {
  test(`leaving while publish waits for ${step} never creates a version`, async ({
    page,
    request,
  }) => {
    const id = await createRule(request, `leave-publish-${step}`);
    const initialRevision = (await readRule(request, id)).revision;
    const target = {
      validate: { url: "/api/validate", method: "POST" },
      save: { url: `/api/rules/${id}`, method: "PUT" },
      publish: { url: `/api/rules/${id}/publish`, method: "POST" },
    }[step];
    // Requests the browser issues; the held one is aborted before the server sees it.
    const issued = {
      validate: [],
      save: [`PUT /api/rules/${id}`],
      publish: [`PUT /api/rules/${id}`, `POST /api/rules/${id}/publish`],
    }[step];
    const writes: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() !== "GET" && sent.url().includes(`/api/rules/${id}`))
        writes.push(`${sent.method()} ${new URL(sent.url()).pathname}`);
    });
    await page.goto(`/#/rules/${id}`);
    await page.getByLabel("Node name", { exact: true }).fill("Edited inputs");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    const pending = await holdRequest(page, target.url, target.method);
    try {
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect.poll(() => pending.state.held).toBe(true);
      // Confirm leaving: unsaved changes, or the pending write itself.
      page.on("dialog", (dialog) => void dialog.accept());
      await page
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("button", { name: "Rule library", exact: true })
        .click();
      await expect(page).toHaveURL(/#\/library$/);
      // Closing the session cancels the pending request. (A request the
      // server already received cannot be undone; the navigation guard warns
      // about that case before leaving.)
      await expect.poll(() => pending.state.aborted).toBe(true);
      pending.release();
      await expect.poll(() => pending.state.settled).toBe(true);
      // Reopening the rule waits for its detail read, after which a late
      // continuation of the abandoned command would already have written.
      await page.goto(`/#/rules/${id}`);
      await expect(
        page.getByRole("heading", { name: `Commands ${id}`, exact: true }),
      ).toBeVisible();
      const saved = await readRule(request, id);
      expect(saved.publishedVersion).toBeNull();
      // Publishing saves first; revisions come from a sequence shared by every rule.
      if (step === "publish")
        expect(saved.revision).toBeGreaterThan(initialRevision);
      else expect(saved.revision).toBe(initialRevision);
      expect(writes).toEqual(issued);
      await expect(page.getByText(/published and ready to call/)).toHaveCount(
        0,
      );
    } finally {
      pending.release();
    }
  });
}

test("an open version history lists a version published while it is open", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "history-refresh");
  await page.goto(`/#/rules/${id}`);
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  const history = page.locator(".version-bar");
  await expect(history).toContainText("No published versions yet");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  await expect(history.getByRole("button", { name: /^v1/ })).toBeVisible();
  await expect(history).not.toContainText("No published versions yet");
});

test("leaving the graph while Arrange waits for its layout module cannot keep the editor locked", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "arrange-view-switch");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(/\/graphLayout[^/]*\.(ts|js)(\?.*)?$/, async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(`/#/rules/${id}`);
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Arrange graph", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    // The sidebar stays usable while a command runs; the same draft opens in code.
    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("button", { name: "Code studio", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
    await expect(
      page.getByRole("textbox", { name: "ARC code editor", exact: true }),
    ).toBeVisible();
    release();
    const graphView = page.getByRole("button", {
      name: "Graph view",
      exact: true,
    });
    await expect(graphView).toBeEnabled();
    await graphView.click();
    await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
    await expect(
      page.getByRole("button", { name: "Arrange graph", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = await readRule(request, id);
    expect(saved.draft.nodes.map((node) => node.position)).not.toEqual(
      definition.nodes.map((node) => node.position),
    );
    expect(saved.draft.edges).toEqual(definition.edges);
  } finally {
    release();
  }
});
