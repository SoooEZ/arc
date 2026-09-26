import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import type { Definition, RuleSummary } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calculate",
      expression: "amount",
      output: "total",
      position: { x: 0, y: 180 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "total",
      position: { x: 0, y: 360 },
    },
  ],
  edges: [
    { id: "next", source: "input", target: "calc", sourceHandle: "next" },
    { id: "done", source: "calc", target: "out", sourceHandle: "next" },
  ],
};
const summaries: RuleSummary[] = Array.from({ length: 45 }, (_, index) => ({
  id: `scroll-formula-${index}`,
  name: `Scroll formula ${index}`,
  description: "",
  kind: "FORMULA",
  revision: 3,
  publishedVersion: 3,
  createdAt: "2026-09-26T00:00:00Z",
  updatedAt: "2026-09-26T00:00:00Z",
  nodeCount: 3,
  inputCount: 1,
  referenceCount: 0,
}));

async function catalog(route: Route) {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset"));
  const limit = Number(url.searchParams.get("limit"));
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

async function openLibrary(page: Page) {
  await page.route("**/api/rules/formula-scroll-caller", (route) =>
    route.fulfill({
      json: {
        ...summaries[0],
        id: "formula-scroll-caller",
        publishedVersion: null,
        draft: definition,
      },
    }),
  );
  await page.route("**/api/rule-summaries?*", catalog);
  await page.goto("/#/rules/formula-scroll-caller?node=calc");
  await page
    .getByRole("button", { name: "Open in Editor · Expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Expression",
    exact: true,
  });
  await dialog.getByRole("button", { name: "@ Formulas", exact: true }).click();
  const results = dialog.getByRole("region", {
    name: "Published formulas",
    exact: true,
  });
  await expect(results.locator(".snippet-card")).toHaveCount(20);
  return {
    dialog,
    results,
    search: dialog.getByLabel("Find published formula"),
  };
}

async function nearEnd(results: Locator) {
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 40;
  });
}

test("Formula library appends bounded pages, searches from the start and only fetches the inserted pin", async ({
  page,
}) => {
  const reads: URL[] = [];
  const pins: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/rule-summaries" &&
      url.searchParams.get("publishedOnly") === "true"
    )
      reads.push(url);
  });
  await page.route("**/api/rules/scroll-formula-*/versions/3", (route) => {
    pins.push(route.request().url());
    const id = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({
      json: {
        ruleId: id,
        version: 3,
        definition,
        publishedAt: "2026-09-26T00:00:00Z",
      },
    });
  });
  const { dialog, results, search } = await openLibrary(page);
  expect(reads.map((url) => url.searchParams.get("offset"))).toEqual(["0"]);
  expect(reads[0].searchParams.get("limit")).toBe("20");
  expect(reads[0].searchParams.get("kind")).toBe("FORMULA");
  expect(pins).toHaveLength(0);
  await expect(
    dialog.getByRole("navigation", { name: "Published formulas pages" }),
  ).toHaveCount(0);
  await results.focus();
  await nearEnd(results);
  await expect(results.locator(".snippet-card")).toHaveCount(40);
  await expect(results).toBeFocused();
  expect(
    await results.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(100);
  expect(reads.map((url) => url.searchParams.get("offset"))).toEqual([
    "0",
    "20",
  ]);
  const loadMore = results.getByRole("button", {
    name: "Load more formulas",
    exact: true,
  });
  await loadMore.focus();
  await page.keyboard.press("Enter");
  await expect(results.locator(".snippet-card")).toHaveCount(45);
  expect(reads.map((url) => url.searchParams.get("offset"))).toEqual([
    "0",
    "20",
    "40",
  ]);
  await search.fill("Scroll formula 44");
  await expect(results.locator(".snippet-card")).toHaveCount(1);
  await expect(search).toBeFocused();
  expect(await results.evaluate((element) => element.scrollTop)).toBe(0);
  expect(reads.at(-1)?.searchParams.get("search")).toBe("Scroll formula 44");
  expect(reads.at(-1)?.searchParams.get("offset")).toBe("0");
  const editor = dialog.getByLabel("Expression code editor", { exact: true });
  await setEditorText(page, editor, "");
  await results.getByRole("button", { name: /Scroll formula 44/ }).click();
  await expect(editorLines(editor)).toHaveText("@scroll-formula-44:3(amount)");
  expect(pins).toHaveLength(1);
  await page.screenshot({
    path: test.info().outputPath("formula-infinite-scroll.png"),
  });
});

for (const failure of [false, true]) {
  test(`a late Formula page ${failure ? "failure" : "success"} cannot replace a newer search`, async ({
    page,
  }) => {
    const { results, search } = await openLibrary(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    let completed = false;
    await page.route("**/api/rule-summaries?*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get("offset") === "20" &&
        !url.searchParams.get("search")
      ) {
        held = true;
        await gate;
        try {
          if (failure)
            await route.fulfill({
              status: 503,
              json: { message: "Obsolete page failure" },
            });
          else await catalog(route);
        } finally {
          completed = true;
        }
        return;
      }
      await catalog(route);
    });
    try {
      await nearEnd(results);
      await expect.poll(() => held).toBe(true);
      await search.fill("Scroll formula 44");
      await expect(results.locator(".snippet-card")).toHaveCount(1);
      await expect(results.locator(".snippet-card")).toContainText(
        "Scroll formula 44",
      );
      release();
      await expect.poll(() => completed).toBe(true);
      await expect(results.locator(".snippet-card")).toHaveCount(1);
      await expect(results.getByRole("alert")).toHaveCount(0);
      await expect(search).toBeFocused();
    } finally {
      release();
    }
  });
}

test("a failed Formula page preserves loaded options and retries the same offset", async ({
  page,
}) => {
  const { results, search } = await openLibrary(page);
  let attempts = 0;
  await page.route("**/api/rule-summaries?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("offset") === "20") {
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Formula catalog unavailable" },
        });
    }
    await catalog(route);
  });
  await nearEnd(results);
  await expect(results.getByRole("alert")).toContainText(
    "Formula catalog unavailable",
  );
  await expect(results.locator(".snippet-card")).toHaveCount(20);
  await results.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(results.locator(".snippet-card")).toHaveCount(40);
  expect(attempts).toBe(2);
  await expect(results.getByRole("alert")).toHaveCount(0);
  await search.fill("no formula matches this");
  await expect(results).toContainText("No matching published formulas.");
  await expect(results.locator(".snippet-card")).toHaveCount(0);
});
