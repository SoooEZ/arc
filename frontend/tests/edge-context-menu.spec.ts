import { expect, test, type Page } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

const definition: Definition = {
  schemaVersion: 1,
  notes: ["Preserve the remaining graph"],
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 250, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calculate",
      expression: "3 + 4",
      output: "total",
      position: { x: 250, y: 190 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "total",
      position: { x: 250, y: 380 },
    },
  ],
  edges: [
    { id: "start", source: "input", sourceHandle: "next", target: "calc" },
    { id: "finish", source: "calc", sourceHandle: "next", target: "out" },
  ],
};

async function fixture(page: Page) {
  let rule: Rule = {
    id: "edge-context-fixture",
    name: "Connection context menu",
    description: "",
    kind: "FORMULA",
    draft: structuredClone(definition),
    revision: 1,
    publishedVersion: 1,
    createdAt: "2026-09-25T00:00:00Z",
    updatedAt: "2026-09-25T00:00:00Z",
  };
  let holdSave: Promise<void> | undefined;
  let saving = false;
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (!url.startsWith("/api/")) return route.continue();
    if (url === "/api/rule-summaries") {
      const { draft, ...metadata } = rule;
      return route.fulfill({
        json: {
          items: [
            {
              ...metadata,
              nodeCount: draft.nodes.length,
              inputCount: draft.inputs.length,
              referenceCount: 0,
            },
          ],
          total: 1,
          offset: 0,
          limit: 20,
        },
      });
    }
    if (url === `/api/rules/${rule.id}`) {
      if (route.request().method() === "PUT") {
        saving = true;
        writes++;
        await holdSave;
        rule = {
          ...rule,
          draft: route.request().postDataJSON().definition,
          revision: rule.revision + 1,
        };
      }
      return route.fulfill({ json: rule });
    }
    if (url.endsWith("/versions/1"))
      return route.fulfill({
        json: {
          ruleId: rule.id,
          version: 1,
          definition,
          publishedAt: rule.createdAt,
        },
      });
    if (url === "/api/variables") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return {
    saved: () => rule,
    writes: () => writes,
    saving: () => saving,
    holdSave: (gate: Promise<void>) => {
      holdSave = gate;
    },
  };
}

const edge = (page: Page, id: string) =>
  page.locator(`.react-flow__edge[data-id="${id}"]`);
async function clickEdge(
  page: Page,
  id: string,
  button: "left" | "right" = "right",
) {
  // Coordinate clicks must wait until a dismissed menu's backdrop has exited.
  await expect(page.locator(".MuiMenu-root")).toHaveCount(0);
  const path = edge(page, id).locator(".react-flow__edge-path");
  await expect(path).toHaveCount(1);
  const point = await path.evaluate((element: SVGPathElement) => {
    const point = element
      .getPointAtLength(element.getTotalLength() / 2)
      .matrixTransform(element.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(point.x, point.y, { button });
}

test("connection context menu deletes the clicked edge, keeps unrelated edits, and dismisses safely", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/#/rules/edge-context-fixture");
  await page.locator('.react-flow__node[data-id="calc"] .graph-node').click();
  await page
    .getByLabel("Node name", { exact: true })
    .fill("Keep this node edit");
  await clickEdge(page, "start", "left");
  await expect(edge(page, "start")).toHaveClass(/selected/);
  await clickEdge(page, "finish");
  const menu = page.getByRole("menu", { name: "Connection actions" });
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(
    menu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(edge(page, "finish")).toHaveCount(1);
  await clickEdge(page, "finish");
  await page.mouse.click(15, 15);
  await expect(menu).not.toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await clickEdge(page, "finish");
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(edge(page, "finish")).toHaveCount(0);
  await expect(edge(page, "start")).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(state.saved().draft.edges).toEqual([definition.edges[0]]);
  expect(state.saved().draft.nodes).toEqual(
    definition.nodes.map((node) =>
      node.id === "calc" ? { ...node, label: "Keep this node edit" } : node,
    ),
  );
  expect(state.saved().draft.notes).toEqual(definition.notes);
  expect(state.saved().draft.inputs).toEqual(definition.inputs);

  await page
    .getByRole("button", { name: "Delete connection", exact: true })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete connection", exact: true }),
  ).toHaveCount(0);
  await page
    .locator('.react-flow__node[data-id="calc"] .graph-node')
    .click({ button: "right" });
  const nodeMenu = page.getByRole("menu", { name: "Node actions" });
  await expect(
    nodeMenu.getByRole("menuitem", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(
    nodeMenu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeEnabled();
});

test("connection context menu obeys historical and pending-save guards", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/#/rules/edge-context-fixture?version=1");
  await clickEdge(page, "finish");
  const menu = page.getByRole("menu", { name: "Connection actions" });
  await expect(
    menu.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(state.writes()).toBe(0);
  expect(state.saved().draft).toEqual(definition);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByLabel("Node name", { exact: true })
    .fill("Edited before save");
  let release = () => {};
  state.holdSave(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(state.saving).toBe(true);
    await clickEdge(page, "finish");
    await expect(
      menu.getByRole("menuitem", { name: "Delete", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await page.keyboard.press("Escape");
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    expect(state.saved().draft.edges).toEqual(definition.edges);
    expect(state.writes()).toBe(1);
    await clickEdge(page, "finish");
    await expect(
      menu.getByRole("menuitem", { name: "Delete", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});
