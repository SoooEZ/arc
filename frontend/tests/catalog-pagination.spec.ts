import { expect, test, type Page, type Route } from "@playwright/test";
import type { Rule, RuleSummary } from "../src/types";

const summaries: RuleSummary[] = Array.from({ length: 45 }, (_, index) => ({
  id: `catalog-${index}`,
  name: `Catalog rule ${index}`,
  description: "",
  kind: "FORMULA",
  revision: 1,
  publishedVersion: 1,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
  nodeCount: 2,
  inputCount: 0,
  referenceCount: 0,
}));
const detail = (index: number): Rule => ({
  ...summaries[index],
  draft: {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "1",
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "output", sourceHandle: "next" },
    ],
  },
});
async function catalog(route: Route) {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset") || 0);
  const limit = Number(url.searchParams.get("limit") || 20);
  const search = url.searchParams.get("search") || "";
  const rows = summaries.filter((rule) =>
    rule.name.toLowerCase().includes(search.toLowerCase()),
  );
  await route.fulfill({
    json: {
      items: rows.slice(offset, offset + limit),
      total: rows.length,
      offset,
      limit,
    },
  });
}
async function mocks(page: Page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/rule-summaries") return catalog(route);
    const id = /^\/api\/rules\/catalog-(\d+)$/.exec(url.pathname);
    if (id) return route.fulfill({ json: detail(Number(id[1])) });
    if (url.pathname === "/api/studio/render")
      return route.fulfill({ json: { source: "" } });
    if (url.pathname === "/api/variables") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
}

test("catalog reads only requested pages and search resets to the first page", async ({
  page,
}) => {
  await mocks(page);
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) reads.push(request.url());
  });
  await page.goto("/#/library");
  await expect(page.locator(".rule-card")).toHaveCount(20);
  await expect(page.locator(".rule-preview-svg")).toHaveCount(20);
  const previewIds = () =>
    reads
      .map((url) => /\/api\/rules\/catalog-(\d+)$/.exec(url)?.[1])
      .filter((id) => id !== undefined)
      .map(Number);
  expect([...new Set(previewIds())].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 20 }, (_, index) => index),
  );
  expect(reads.some((url) => /\/api\/rules(?:\?|$)/.test(url))).toBe(false);
  await page
    .getByRole("navigation", { name: "Library rules pages" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.locator(".rule-card").first()).toContainText(
    "Catalog rule 20",
  );
  await expect(page.locator(".rule-card")).toHaveCount(20);
  await expect(page.locator(".rule-preview-svg")).toHaveCount(20);
  expect([...new Set(previewIds())].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 40 }, (_, index) => index),
  );
  await page
    .getByRole("textbox", { name: "Search rules" })
    .fill("Catalog rule 44");
  await expect(page.locator(".rule-card")).toHaveCount(1);
  await expect(page.locator(".rule-card")).toContainText("Catalog rule 44");
  await expect(page.locator(".rule-preview-svg")).toHaveCount(1);
  expect(previewIds().filter((id) => id >= 40)).toEqual([44]);
  const searches = reads.filter(
    (url) =>
      url.includes("/rule-summaries") &&
      new URL(url).searchParams.get("search") === "Catalog rule 44",
  );
  expect(searches.length).toBeGreaterThan(0);
  expect(
    searches.every((url) => new URL(url).searchParams.get("offset") === "0"),
  ).toBe(true);
  await page.locator(".rule-card").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  expect(reads.some((url) => url.endsWith("/api/rules/catalog-44"))).toBe(true);
});

test("a catalog failure cannot block a direct link outside the current page", async ({
  page,
}) => {
  await mocks(page);
  await page.route("**/api/rule-summaries?*", (route) =>
    route.fulfill({ status: 503, json: { message: "Catalog unavailable" } }),
  );
  await page.goto("/#/rules/catalog-44");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".editor-title")).toContainText("Catalog rule 44");
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Code studio", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/studio\/catalog-44$/);
});

test("a late search response cannot replace newer catalog results", async ({
  page,
}) => {
  await mocks(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/rule-summaries?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("search") ===
      "Catalog rule 2"
    ) {
      held = true;
      await gate;
    }
    await catalog(route);
  });
  try {
    await page.goto("/#/library");
    await page
      .getByRole("textbox", { name: "Search rules" })
      .fill("Catalog rule 2");
    await expect.poll(() => held).toBe(true);
    await page
      .getByRole("textbox", { name: "Search rules" })
      .fill("Catalog rule 44");
    await expect(page.locator(".rule-card")).toHaveCount(1);
    await expect(page.locator(".rule-card")).toContainText("Catalog rule 44");
    release();
    await expect(page.locator(".rule-card")).toHaveCount(1);
    await expect(page.locator(".rule-card")).toContainText("Catalog rule 44");
  } finally {
    release();
  }
});

test("library search waits for typing to pause and keeps cards and previews while results load", async ({
  page,
}) => {
  await mocks(page);
  const searches: string[] = [];
  const previews: number[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/rule-summaries")
      searches.push(url.searchParams.get("search") ?? "");
    const id = /^\/api\/rules\/catalog-(\d+)$/.exec(url.pathname);
    if (id) previews.push(Number(id[1]));
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rule-summaries?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("search")) await gate;
    await catalog(route);
  });
  try {
    await page.goto("/#/library");
    await expect(page.locator(".rule-preview-svg")).toHaveCount(20);
    const search = page.getByRole("textbox", { name: "Search rules" });
    await search.pressSequentially("Catalog rule 4", { delay: 40 });
    await expect
      .poll(() => searches.filter(Boolean).at(-1))
      .toBe("Catalog rule 4");
    // Typing is not a request per keystroke.
    expect(searches.filter(Boolean).length).toBeLessThanOrEqual(2);
    // The shown cards and their previews stay while the search is pending.
    await expect(page.getByLabel("Loading rules")).toBeVisible();
    await expect(page.locator(".rule-card")).toHaveCount(20);
    await expect(page.locator(".rule-preview-svg")).toHaveCount(20);
    release();
    await expect(page.locator(".rule-card")).toHaveCount(6);
    await expect(page.locator(".rule-preview-svg")).toHaveCount(6);
    await search.fill("");
    await expect(page.locator(".rule-card")).toHaveCount(20);
    await expect(page.locator(".rule-preview-svg")).toHaveCount(20);
    // Remounted cards reuse the preview of an unchanged rule revision.
    expect(previews.filter((id) => id === 4)).toHaveLength(1);
    expect(new Set(previews).size).toBe(previews.length);
  } finally {
    release();
  }
});

test("saving a rule neither reloads the hidden library nor resets its page", async ({
  page,
}) => {
  await mocks(page);
  await page.route("**/api/rules/catalog-20", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...detail(20),
        name: body.name,
        description: body.description,
        draft: body.definition,
        revision: 2,
      },
    });
  });
  const catalogReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/rule-summaries") catalogReads.push(url.search);
  });
  await page.goto("/#/library");
  await page
    .getByRole("navigation", { name: "Library rules pages" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.locator(".rule-card").first()).toContainText(
    "Catalog rule 20",
  );
  await page
    .getByRole("button", { name: "Open graph: Catalog rule 20", exact: true })
    .click();
  await page.getByLabel("Node name", { exact: true }).fill("Inputs renamed");
  const readsBeforeSave = catalogReads.length;
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  expect(catalogReads.slice(readsBeforeSave)).toEqual([]);

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Rule library", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Library rules pages" }),
  ).toContainText("21–40 of 45");
  await expect(page.locator(".rule-card").first()).toContainText(
    "Catalog rule 20",
  );
  // Returning to the library reloads the stale page once, at its offset.
  await expect
    .poll(() => catalogReads.slice(readsBeforeSave))
    .toEqual(["?offset=20&limit=20&search=&kind="]);
});

test("Code studio opens a rule whatever the library filter shows", async ({
  page,
}) => {
  await mocks(page);
  await page.goto("/#/library");
  await expect(page.locator(".rule-card")).toHaveCount(20);
  await page.getByRole("textbox", { name: "Search rules" }).fill("zzz");
  await expect(page.getByText("No rules match this view")).toBeVisible();
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await workspace
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Code studio", exact: true })
    .click();
  // The most recently updated rule, not the (empty) filtered library page.
  await expect(page).toHaveURL(/#\/studio\/catalog-0$/);
  await expect(page.getByRole("dialog", { name: "Create a rule" })).toHaveCount(
    0,
  );

  // After a rule was opened, Code studio returns to it.
  await page.evaluate(() => {
    window.location.hash = "/rules/catalog-44";
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await workspace
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Code studio", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/studio\/catalog-44$/);
});
