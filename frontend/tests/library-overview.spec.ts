import { expect, test, type Page } from "@playwright/test";
import type { Rule, RuleNode, RuleSummary } from "../src/types";

function node(id: string, type: RuleNode["type"], label: string): RuleNode {
  return { id, type, label, position: { x: 0, y: 0 }, expression: "1" };
}
const complex: Rule = {
  id: "overview-complex",
  name: "Branching and joining",
  description: "Every branch rejoins before returning the result.",
  kind: "DECISION_TREE",
  revision: 1,
  publishedVersion: null,
  createdAt: "2026-09-26T00:00:00Z",
  updatedAt: "2026-09-26T00:00:00Z",
  draft: {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    ],
    nodes: [
      node("input", "INPUT", "Inputs"),
      {
        ...node("switch", "SWITCH", "Choose range"),
        selector: "amount",
        cases: [
          { id: "low", label: "Low", expression: "1" },
          { id: "high", label: "High", expression: "2" },
        ],
      },
      node("low", "FORMULA", "Low fee"),
      node("condition", "CONDITION", "Check loyalty"),
      node("default", "FORMULA", "Default fee"),
      node("high", "FORMULA", "Loyal fee"),
      node("mid", "FORMULA", "Regular fee"),
      { ...node("join", "TRANSFORM", "Collect result"), fields: [] },
      node("output", "OUTPUT", "Return result"),
    ],
    edges: [
      ["input", "switch", "next"],
      ["switch", "low", "case:low"],
      ["switch", "condition", "case:high"],
      ["switch", "default", "default"],
      ["condition", "high", "true"],
      ["condition", "mid", "false"],
      ["low", "join", "next"],
      ["high", "join", "next"],
      ["mid", "join", "next"],
      ["default", "join", "next"],
      ["join", "output", "next"],
    ].map(([source, target, sourceHandle], index) => ({
      id: `edge-${index}`,
      source,
      target,
      sourceHandle,
    })),
  },
};
const simple: Rule = {
  ...complex,
  id: "overview-simple",
  name: "One input",
  kind: "FORMULA",
  draft: {
    ...complex.draft,
    nodes: [node("one", "INPUT", "aaaaaaaaaaaaa😀tail")],
    edges: [],
  },
};
function summary(rule: Rule): RuleSummary {
  return {
    ...rule,
    nodeCount: rule.draft.nodes.length,
    inputCount: rule.draft.inputs.length,
    referenceCount: 0,
  };
}
async function mockLibrary(page: Page, rules: Rule[] = [complex, simple]) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/rule-summaries") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const items = rules
        .filter((rule) => rule.name.toLowerCase().includes(search))
        .map(summary);
      return route.fulfill({
        json: { items, total: items.length, offset: 0, limit: 20 },
      });
    }
    const rule = rules.find((rule) => url.pathname === `/api/rules/${rule.id}`);
    if (rule) return route.fulfill({ json: rule });
    if (url.pathname === "/api/studio/render")
      return route.fulfill({ json: { source: "" } });
    if (url.pathname === "/api/variables") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
}

test("automatic previews show every branch and join, fit all nodes, and open the full canvas", async ({
  page,
}, testInfo) => {
  await mockLibrary(page);
  await page.goto("/#/library");
  const card = page.locator(".rule-card").filter({ hasText: complex.name });
  const preview = card.getByRole("img", { name: /complete graph overview/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-detail", "overview");
  await expect(preview.locator("[data-preview-node]")).toHaveCount(9);
  await expect(preview.locator("[data-preview-edge]")).toHaveCount(11);
  expect(
    await preview
      .locator("[data-preview-node]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-preview-node")).sort(),
      ),
  ).toEqual(complex.draft.nodes.map((node) => node.id).sort());
  const bounds = await preview.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const box = svg.viewBox.baseVal;
    return [...svg.querySelectorAll<SVGGElement>("[data-preview-node]")].every(
      (node) => {
        const rect = node.getBBox();
        const transform = node.transform.baseVal.consolidate()!.matrix;
        return (
          rect.x + transform.e >= box.x &&
          rect.y + transform.f >= box.y &&
          rect.x + transform.e + rect.width <= box.width &&
          rect.y + transform.f + rect.height <= box.height
        );
      },
    );
  });
  expect(bounds).toBe(true);
  await expect(card).toContainText("Draft overview · open to explore");
  const small = page.locator(".rule-card").filter({ hasText: simple.name });
  await expect(small.locator(".rule-preview-svg")).toHaveAttribute(
    "data-detail",
    "labels",
  );
  await expect(small.locator(".preview-node-label")).toHaveText(
    "aaaaaaaaaaaaa😀tail",
  );
  await expect(small).toContainText("1 node");
  await expect(small).toContainText("1 input");
  await expect(small).not.toContainText("1 nodes");
  await expect(small).not.toContainText("1 inputs");
  await page.screenshot({
    path: testInfo.outputPath("library-overviews-desktop.png"),
    fullPage: true,
  });
  await card
    .getByRole("button", { name: `Open graph: ${complex.name}` })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(9);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await expect(
    page.getByRole("button", { name: "Zoom In", exact: true }),
  ).toBeVisible();
});

test("navigation defaults to compact, persists its toggle, and overlays narrow screens", async ({
  page,
}, testInfo) => {
  await mockLibrary(page);
  await page.goto("/#/library");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveClass(/is-compact/);
  await expect(page.getByLabel("Find sidebar rule")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Sidebar rules pages" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Code studio", exact: true }).hover();
  await expect(
    page.getByRole("tooltip", { name: "Code studio" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(sidebar.locator(".main-nav .nav-label").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse navigation" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(sidebar).toHaveClass(/is-expanded/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Close navigation", exact: true }),
  ).toBeVisible();
  const before = await page.locator(".main-content").boundingBox();
  expect(before?.x).toBe(68);
  expect(before?.width).toBe(322);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: testInfo.outputPath("navigation-mobile-expanded.png"),
    fullPage: true,
  });
  await sidebar.getByRole("button", { name: "Getting started" }).focus();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByRole("button", { name: "ARC home" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveClass(/is-compact/);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Expand navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click({ position: { x: 350, y: 400 } });
  await expect(sidebar).toHaveClass(/is-compact/);
  await expect(page.locator(".rule-preview-svg")).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("library-overviews-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/docs$/);
  await expect(sidebar).toHaveClass(/is-compact/);
});

test("preview failures retry in place and missing canvas positions still show the graph", async ({
  page,
}) => {
  await mockLibrary(page, [complex]);
  let reads = 0;
  await page.route(`**/api/rules/${complex.id}`, (route) => {
    reads++;
    if (reads === 1)
      return route.fulfill({
        status: 503,
        json: { message: "Preview service unavailable" },
      });
    return route.fulfill({
      json: {
        ...complex,
        draft: {
          ...complex.draft,
          nodes: complex.draft.nodes.map((node) => ({
            ...node,
            position: undefined,
          })),
        },
      },
    });
  });
  await page.goto("/#/library");
  await expect(page.getByText("Graph preview unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.locator("[data-preview-node]")).toHaveCount(9);
  expect(reads).toBe(2);
  await expect(page).toHaveURL(/#\/library$/);
});

test("leaving a catalog page cancels its preview and late data cannot replace the new card", async ({
  page,
}) => {
  await mockLibrary(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let canceled = false;
  page.on("requestfailed", (request) => {
    if (request.url().endsWith(`/api/rules/${complex.id}`)) canceled = true;
  });
  await page.route(`**/api/rules/${complex.id}`, async (route) => {
    held = true;
    await gate;
    await route.fulfill({ json: complex });
  });
  try {
    await page.goto("/#/library");
    await expect.poll(() => held).toBe(true);
    await page.getByRole("textbox", { name: "Search rules" }).fill(simple.name);
    await expect(page.locator(".rule-card")).toHaveCount(1);
    await expect(page.locator(".rule-preview-svg")).toHaveAttribute(
      "aria-label",
      /One input/,
    );
    await expect.poll(() => canceled).toBe(true);
    release();
    await expect(page.locator("[data-preview-node]")).toHaveCount(1);
    await expect(page.locator("[data-preview-node]")).toHaveAttribute(
      "data-preview-node",
      "one",
    );
    await expect(page.locator(".rule-card")).not.toContainText(complex.name);
  } finally {
    release();
  }
});
