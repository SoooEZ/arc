import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { createRule as createApiRule } from "./helpers/api";

const basic: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 300, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 300, y: 220 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

async function createRule(
  request: APIRequestContext,
  prefix: string,
  definition: Definition = basic,
) {
  const id = `${prefix}-${Date.now()}`;
  await createApiRule(request, { id, name: `Resilience ${id}`, definition });
  return id;
}

async function publish(request: APIRequestContext, id: string) {
  const rule = (await (await request.get(`/api/rules/${id}`)).json()) as Rule;
  const published = await request.post(`/api/rules/${id}/publish`, {
    data: { revision: rule.revision },
  });
  expect(published.ok()).toBeTruthy();
  return (await published.json()) as Rule;
}

const card = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);
const nodeName = (page: Page) => page.getByLabel("Node name", { exact: true });

/** Fails the lazily loaded module whose file name starts with `name`. */
async function failChunk(page: Page, name: string) {
  await page.route(
    new RegExp(`/${name}[^/]*\\.(ts|tsx|js)(\\?.*)?$`),
    (route) => route.abort("failed"),
  );
}

test("node IDs named after Object members open, select and show their diagnostics", async ({
  page,
  request,
}) => {
  const ids = ["constructor", "toString", "valueOf", "__proto__"];
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      ...ids.map((id, index) => ({
        id,
        type: "OUTPUT" as const,
        label: `Node ${id}`,
        expression: id === "valueOf" ? "missing + 1" : "amount",
        position: { x: index * 260, y: 240 },
      })),
    ],
    // Connection IDs are free-form too; none of these routes is blocked.
    edges: ids.map((id) => ({
      id,
      source: "input",
      target: id,
      sourceHandle: "next",
    })),
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const id = await createRule(request, "object-member-ids", definition);
  const variables = page.waitForResponse((response) =>
    response.url().endsWith("/api/variables"),
  );
  await page.goto(`/#/rules/${id}`);
  await variables;
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(card(page, "valueOf").locator(".graph-node")).toHaveClass(
    /node-error/,
  );
  for (const nodeId of ids) {
    await card(page, nodeId).locator(".graph-node").click();
    await expect(nodeName(page)).toHaveValue(`Node ${nodeId}`);
    await expect(card(page, nodeId)).toHaveClass(/selected/);
    await expect(card(page, nodeId).locator(".node-error-message")).toHaveCount(
      nodeId === "valueOf" ? 1 : 0,
    );
  }
  await card(page, "valueOf").locator(".graph-node").click();
  await expect(
    page.getByRole("button", { name: "Node errors (1)", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator(".routing-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an API draft without node positions can add a default return", async ({
  page,
  request,
}) => {
  const definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: null },
      {
        id: "route",
        type: "SWITCH",
        label: "Route",
        position: { x: 400, y: 260 },
        cases: [{ id: "case-1", label: "Big", expression: "amount > 100" }],
      },
      {
        id: "big",
        type: "OUTPUT",
        label: "Big",
        expression: "1",
        position: { x: 400, y: 520 },
      },
    ],
    edges: [
      { id: "e1", source: "input", target: "route", sourceHandle: "next" },
      { id: "e2", source: "route", target: "big", sourceHandle: "case:case-1" },
    ],
  } as unknown as Definition;
  const id = await createRule(request, "unplaced-nodes", definition);
  await page.goto(`/#/rules/${id}?node=route`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(nodeName(page)).toHaveValue("Route");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page
    .getByRole("button", { name: "Add default return", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await (await request.get(`/api/rules/${id}`)).json()) as Rule;
  expect(saved.draft.nodes[0].position).toEqual({ x: 0, y: 0 });
  expect(saved.draft.nodes).toHaveLength(4);
  expect(saved.draft.edges.at(-1)).toMatchObject({
    source: "route",
    sourceHandle: "default",
  });
});

test("deleting a node while its code dialog loads releases the inspector", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "delete-loading-dialog");
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
    await expect(nodeName(page)).toBeEnabled();
    await page
      .getByRole("button", { name: "Node expression · Result", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await expect(nodeName(page)).toBeDisabled();
    await card(page, "out").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(card(page, "out")).toHaveCount(0);
    await expect(nodeName(page)).toBeEnabled();
    release();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await nodeName(page).fill("Still editable");
    await expect(card(page, "input")).toContainText("Still editable");
  } finally {
    release();
  }
});

test("a node editor that is still loading can be cancelled", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "cancel-loading-editor");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(/\/NodeEditDialog[^/]*\.(tsx|js)(\?.*)?$/, async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(`/#/rules/${id}`);
    await expect(nodeName(page)).toBeEnabled();
    await card(page, "out").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(
      page.getByRole("status").filter({ hasText: "Loading the node editor" }),
    ).toBeVisible();
    await expect(nodeName(page)).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(nodeName(page)).toBeEnabled();
    release();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await nodeName(page).fill("Editable after cancel");
    await expect(card(page, "input")).toContainText("Editable after cancel");
  } finally {
    release();
  }
});

test("a node editor that cannot load can be cancelled without losing the draft", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "failed-node-editor");
  await failChunk(page, "NodeEditDialog");
  await page.goto(`/#/rules/${id}`);
  await nodeName(page).fill("Edited before failure");
  await card(page, "out").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "Could not load the node editor" });
  await expect(failure).toBeVisible();
  await expect(nodeName(page)).toBeDisabled();
  await failure.getByRole("button", { name: "Close", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(nodeName(page)).toBeEnabled();
  await expect(nodeName(page)).toHaveValue("Edited before failure");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("a code editor or JSON editor that cannot load keeps the editor and the draft", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "failed-lazy-views");
  await failChunk(page, "CodeStudio");
  await failChunk(page, "InputJsonEditor");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/#/rules/${id}`);
  await nodeName(page).fill("Kept through failures");
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load the code editor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Resilience ${id}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(nodeName(page)).toHaveValue("Kept through failures");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load the JSON editor" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("10");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await (await request.get(`/api/rules/${id}`)).json()) as Rule;
  expect(saved.draft.nodes[0].label).toBe("Kept through failures");
  expect(errors).toEqual([]);
});

test("a published version selects one of its own nodes when the draft's selection is missing from it", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "version-selection");
  await publish(request, id);
  const current = (await (
    await request.get(`/api/rules/${id}`)
  ).json()) as Rule;
  const updated = await request.put(`/api/rules/${id}`, {
    data: {
      name: current.name,
      description: current.description,
      revision: current.revision,
      definition: {
        ...basic,
        nodes: [
          ...basic.nodes,
          {
            id: "node-new1",
            type: "CONDITION",
            label: "Added later",
            expression: "true",
            position: { x: 600, y: 120 },
          },
        ],
      },
    },
  });
  expect(updated.ok()).toBeTruthy();
  await page.goto(`/#/rules/${id}?version=1`);
  await expect(page.getByText("Immutable published version")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(nodeName(page)).toHaveValue("Inputs");
  await expect(card(page, "input")).toHaveClass(/selected/);
});

test("export keeps the download URL alive after the click", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "export-url");
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      click.call(this);
      const link = this.href;
      // Engines that start the download after the click need the URL then.
      setTimeout(() => {
        fetch(link)
          .then((response) => response.text())
          .then(
            (text) => Object.assign(window, { exportedText: text }),
            () => Object.assign(window, { exportedText: "revoked" }),
          );
      }, 0);
    };
  });
  await page.goto(`/#/rules/${id}`);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export definition", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(`${id}-draft.json`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as { exportedText?: string }).exportedText),
    )
    .toBeDefined();
  const exported = await page.evaluate(
    () => (window as { exportedText?: string }).exportedText!,
  );
  expect(exported).not.toBe("revoked");
  expect(
    JSON.parse(exported).nodes.map((node: { id: string }) => node.id),
  ).toEqual(["input", "out"]);
});

test("preview errors from a published self-reference or a rule named preview open that rule instead of marking this graph", async ({
  page,
  request,
}) => {
  const id = await createRule(request, "self-reference-error");
  await publish(request, id);
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  // Location lists as the engine reports them: the failing child first, then
  // each caller up to the preview root.
  const failures = [
    {
      message: "Division by zero",
      locations: [
        { ruleId: id, version: 1, nodeId: "out", label: "Published result" },
        { ruleId: "preview", version: null, nodeId: "input", label: "Inputs" },
      ],
    },
    {
      message: "Missing value",
      locations: [
        { ruleId: "preview", version: 3, nodeId: "out", label: "Child result" },
        { ruleId: "preview", version: null, nodeId: "input", label: "Inputs" },
      ],
    },
  ];
  for (const failure of failures) {
    await page.route("**/api/preview", (route) =>
      route.fulfill({
        status: 422,
        json: { status: 422, ...failure, issues: [failure.message] },
      }),
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: failure.message });
    await expect(alert).toBeVisible();
    await expect(
      alert.getByRole("button", { name: "Show problem · Inputs", exact: true }),
    ).toBeVisible();
    await expect(
      alert.getByRole("button", {
        name: `Open problem · ${failure.locations[0].label}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(card(page, "out").locator(".graph-node")).not.toHaveClass(
      /node-error/,
    );
    await expect(card(page, "input").locator(".graph-node")).toHaveClass(
      /node-error/,
    );
    await page.unroute("**/api/preview");
  }
});
