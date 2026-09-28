import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule as createApiRule, readRule } from "./helpers/api";
import { editorLines } from "./helpers/editor";

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
  await createApiRule(request, { id, name: `Commands ${id}`, definition });
  return id;
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

test("a graph arrival with unbuilt code applies once the running build ends, and the header names the shown view", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "arrival-after-build");
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
  const code = page.getByRole("textbox", {
    name: "ARC code editor",
    exact: true,
  });
  await code.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("End");
  await page.keyboard.type("\nnode broken");
  const pending = await holdRequest(page, "/api/studio/build", "POST");
  try {
    await page
      .getByRole("button", { name: "Build graph", exact: true })
      .click();
    await expect.poll(() => pending.state.held).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
    // The code stays on screen while the build holds the lock; the header said "Code editor".
    await expect(code).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Graph view", exact: true }),
    ).toBeVisible();
    pending.release();
    // The arrival rule applies once the lock is free: the failing code returns to its route.
    await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
    await expect(code).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Graph view", exact: true }),
    ).toBeEnabled();
  } finally {
    pending.release();
  }
  await code.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Code editor", exact: true }),
  ).toBeVisible();
});

test("node code cannot open while Arrange runs, and opens with the arranged position afterwards", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "arrange-node-code");
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
  const codeButton = page.getByRole("button", {
    name: "Node expression · Calculation",
    exact: true,
  });
  try {
    await page.goto(`/#/rules/${id}`);
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await expect(codeButton).toBeEnabled();
    await page
      .getByRole("button", { name: "Arrange graph", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    // A dialog opened now would render, and later apply, the positions from before the layout.
    await expect(codeButton).toBeDisabled();
    release();
    await expect(codeButton).toBeEnabled();
  } finally {
    release();
  }
  await codeButton.click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Calculation",
    exact: true,
  });
  const shown = dialog.getByLabel("Node code editor", { exact: true });
  await expect(editorLines(shown)).toContainText("at (");
  await expect(editorLines(shown)).not.toContainText("at (40, 420)");
  const arranged = /at \((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)/.exec(
    (await editorLines(shown).innerText()).replace(/\u00a0/g, " "),
  )!;
  await dialog.getByRole("button", { name: "Apply to graph" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await readRule(request, id);
  expect(
    saved.draft.nodes.find((node) => node.id === "calculate")!.position,
  ).toEqual({ x: Number(arranged[1]), y: Number(arranged[2]) });
});

test("Arrange lays out a large graph off the main thread, and a failing worker releases the editor", async ({
  page,
  request,
}) => {
  const nodes: Definition["nodes"] = [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
  ];
  for (let index = 1; index < 99; index++)
    nodes.push({
      id: `n${index}`,
      type: "FORMULA",
      label: `Step ${index}`,
      expression: index === 1 ? "amount" : `v${index - 1}`,
      output: `v${index}`,
      position: {
        x: (index % 10) * 300,
        y: Math.floor(index / 10) * 200 + 200,
      },
    });
  nodes.push({
    id: "out",
    type: "OUTPUT",
    label: "Result",
    expression: "v98",
    position: { x: 0, y: 2400 },
  });
  const edges: Definition["edges"] = nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    source: nodes[index].id,
    target: node.id,
    sourceHandle: "next",
  }));
  // Long-span edges make the layered layout expensive.
  let seed = 7;
  for (let index = 0; index < 100; index++) {
    seed = (seed * 48271) % 2147483647;
    const from = 1 + (seed % 96);
    const to = from + 1 + ((seed >> 8) % (98 - from));
    if (to <= from || to > 98) continue;
    edges.push({
      id: `l${index}`,
      source: `n${from}`,
      target: `n${to}`,
      sourceHandle: "next",
    });
  }
  const id = `arrange-worker-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: {
      id,
      name: `Arrange worker ${id}`,
      kind: "FORMULA",
      definition: {
        schemaVersion: 1,
        inputs: [
          { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
        ],
        nodes,
        edges,
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const workerScripts: string[] = [];
  page.on("request", (outgoing) => {
    if (/elk-worker/.test(outgoing.url())) workerScripts.push(outgoing.url());
  });
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    Object.assign(window, { __longTasks: longTasks });
  });
  await page.goto(`/#/rules/${id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(100);
  await page.evaluate(
    () =>
      ((window as unknown as { __longTasks: number[] }).__longTasks.length = 0),
  );
  const before = (await (await request.get(`/api/rules/${id}`)).json()).draft
    .nodes[5].position;
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  // ELK ran on the main thread as one long task of 1.3 s on this graph; off
  // the main thread, what remains is the arranged graph's render and routing.
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks,
  );
  expect(Math.max(0, ...longTasks)).toBeLessThan(800);
  expect(workerScripts.length).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const after = (await (await request.get(`/api/rules/${id}`)).json()).draft
    .nodes[5].position;
  expect(after).not.toEqual(before);

  // A worker that cannot load reports an error and releases the commands (lesson F8).
  await page.route(/elk-worker/, (route) => route.abort());
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  // The development server loads the worker module itself under that name; either failure
  // reports through the same alert and releases the commands.
  await expect(page.getByRole("alert")).toContainText(
    /layout worker|Arrange|imported module/i,
  );
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
});
