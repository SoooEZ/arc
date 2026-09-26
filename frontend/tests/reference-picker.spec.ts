import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule, RuleSummary } from "../src/types";

async function fixture(request: APIRequestContext, versions = 2) {
  const id = `reference-picker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [{ name: "amount", type: "NUMBER", required: true }],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "amount * 2",
        position: { x: 200, y: 360 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "out", sourceHandle: "next" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: {
      id: `${id}-child`,
      name: `Selected child ${id}`,
      kind: "FORMULA",
      definition,
    },
  });
  expect(response.status()).toBe(201);
  let child: Rule = await response.json();
  for (let version = 0; version < versions; version++) {
    const published = await request.post(`/api/rules/${child.id}/publish`, {
      data: { revision: child.revision },
    });
    expect(published.ok()).toBeTruthy();
    child = await published.json();
  }
  const parentDefinition: Definition = {
    ...definition,
    inputs: [],
    nodes: [
      definition.nodes[0],
      {
        id: "ref",
        type: "REFERENCE",
        label: "Reuse child",
        ruleId: child.id,
        version: 1,
        bindings: { amount: 7 },
        output: "answer",
        position: { x: 200, y: 180 },
      },
      { ...definition.nodes[1], expression: "answer" },
    ],
    edges: [
      { id: "start", source: "input", target: "ref", sourceHandle: "next" },
      { id: "end", source: "ref", target: "out", sourceHandle: "next" },
    ],
  };
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition: parentDefinition },
  });
  expect(created.status()).toBe(201);
  return { parent: (await created.json()) as Rule, child };
}

const sidebar = (page: Page) => page.locator(".inspector-sidebar");
const summary = (index: number): RuleSummary => ({
  id: `picker-option-${index}`,
  name: `Picker option ${String(index).padStart(2, "0")}`,
  description: "",
  kind: "FORMULA",
  revision: 1,
  publishedVersion: 1,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
  nodeCount: 2,
  inputCount: 0,
  referenceCount: 0,
});
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test("reference typeahead preserves off-page pins, appends without focus or scroll jumps, and searches actual versions", async ({
  page,
  request,
}) => {
  const { parent, child } = await fixture(request, 24);
  const reads: { search: string; offset: number; limit: number }[] = [];
  let gate = deferred();
  let waiting = false;
  await page.route("**/api/rule-summaries?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("publishedOnly") !== "true") return route.continue();
    const search = query.get("search") || "";
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    reads.push({ search, offset, limit });
    if (offset > 0) {
      waiting = true;
      await gate.promise;
    }
    const items = search
      ? `${child.id} ${child.name}`.includes(search)
        ? [child]
        : []
      : offset === 0
        ? Array.from({ length: 20 }, (_, i) => summary(i))
        : [
            summary(19),
            ...Array.from({ length: 5 }, (_, i) => summary(20 + i)),
          ];
    await route.fulfill({
      json: { items, total: search ? items.length : 26, offset, limit },
    });
  });
  try {
    await page.goto(`/#/rules/${parent.id}?node=ref`);
    const rule = sidebar(page).getByRole("combobox", {
      name: "Published rule",
      exact: true,
    });
    const version = sidebar(page).getByRole("combobox", {
      name: "Pinned version",
      exact: true,
    });
    await expect(rule).toHaveValue(child.name);
    await expect(version).toHaveValue("Version 1");
    expect(reads).toEqual([]);
    await expect(
      sidebar(page).getByLabel("Find published rule", { exact: true }),
    ).toHaveCount(0);
    await expect(sidebar(page).getByRole("navigation")).toHaveCount(0);
    await rule.click();
    await expect(page.getByRole("option")).toHaveCount(20);
    expect(reads).toEqual([{ search: "", offset: 0, limit: 20 }]);
    const listbox = page.getByRole("listbox");
    const bottom = await listbox.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    await expect.poll(() => waiting).toBe(true);
    await expect(rule).toBeFocused();
    gate.release();
    await expect(page.getByRole("option")).toHaveCount(25);
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBe(bottom);
    await expect(rule).toBeFocused();
    expect(reads.at(-1)).toEqual({ search: "", offset: 20, limit: 20 });
    await rule.press("Escape");
    await expect(rule).toHaveValue(child.name);
    await expect(version).toHaveValue("Version 1");

    // A user may scroll back to the very top while an appended page is pending.
    gate = deferred();
    waiting = false;
    await rule.click();
    await expect(page.getByRole("option")).toHaveCount(20);
    await listbox.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => waiting).toBe(true);
    await listbox.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBe(0);
    gate.release();
    await expect(page.getByRole("option")).toHaveCount(25);
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBe(0);
    await rule.fill(child.id);
    await expect(page.getByRole("option")).toHaveCount(1);
    await rule.press("ArrowDown");
    await rule.press("Enter");
    await expect(version).toHaveValue("Version 1");
    await expect(
      sidebar(page).getByLabel("amount *", { exact: true }),
    ).toHaveValue("7");
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();

    const versionReads: URL[] = [];
    page.on("request", (request) => {
      if (request.url().includes("version-summaries"))
        versionReads.push(new URL(request.url()));
    });
    // Keyboard input starts while the field is closed: the first character must survive onOpen.
    await version.focus();
    await version.selectText();
    await version.press("2");
    await expect(version).toHaveValue("2");
    await expect(page.getByRole("option")).toHaveText([
      "Version 24",
      "Version 23",
      "Version 22",
      "Version 21",
      "Version 20",
      "Version 12",
      "Version 2",
    ]);
    expect(versionReads.at(-1)?.searchParams.get("search")).toBe("2");
    expect(versionReads.at(-1)?.searchParams.get("offset")).toBe("0");
    await version.press("Escape");
    await expect(version).toHaveValue("Version 1");
    await version.click();
    await expect(page.getByRole("option")).toHaveCount(20);
    await page.getByRole("listbox").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.getByRole("option")).toHaveCount(24);
    await page.getByRole("option", { name: "Version 2", exact: true }).click();
    await expect(version).toHaveValue("Version 2");
    expect(
      versionReads.some((url) =>
        url.searchParams.get("search")?.startsWith("Version"),
      ),
    ).toBe(false);
    await expect(
      sidebar(page).getByLabel("amount * · value source", { exact: true }),
    ).toHaveText("Upstream variable");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved: Rule = await (
      await request.get(`/api/rules/${parent.id}`)
    ).json();
    expect(saved.draft.nodes.find((node) => node.id === "ref")).toMatchObject({
      ruleId: child.id,
      version: 2,
      bindings: {},
    });
  } finally {
    gate.release();
  }
});

test("reference search ignores a stale response and exposes loading, empty and keyboard retry states", async ({
  page,
  request,
}) => {
  const { parent, child } = await fixture(request);
  const gate = deferred();
  let held = false;
  let retry = false;
  const searches: string[] = [];
  await page.route("**/api/rule-summaries?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("publishedOnly") !== "true") return route.continue();
    const search = params.get("search") || "";
    searches.push(search);
    if (search === "old") {
      held = true;
      await gate.promise;
    }
    if (search === "retry" && !retry) {
      retry = true;
      return route.fulfill({
        status: 503,
        json: { message: "Picker temporarily unavailable" },
      });
    }
    const items =
      search === "missing"
        ? []
        : [{ ...child, name: search === "old" ? "Old result" : child.name }];
    await route.fulfill({
      json: { items, total: items.length, offset: 0, limit: 20 },
    });
  });
  try {
    await page.goto(`/#/rules/${parent.id}?node=ref`);
    const rule = sidebar(page).getByRole("combobox", {
      name: "Published rule",
      exact: true,
    });
    await expect(rule).toHaveValue(child.name);
    await rule.focus();
    await rule.selectText();
    await rule.press("o");
    await expect(rule).toHaveValue("o");
    await rule.fill("old");
    await expect.poll(() => held).toBe(true);
    await expect(
      page.getByText("Loading results…", { exact: true }),
    ).toBeVisible();
    await rule.fill("new");
    await expect(page.getByRole("option")).toHaveText([child.name]);
    gate.release();
    await expect(
      page.getByRole("option", { name: "Old result", exact: true }),
    ).toHaveCount(0);
    await rule.fill("missing");
    await expect(
      page.getByText("No matching results", { exact: true }),
    ).toBeVisible();
    await rule.fill("retry");
    await expect(page.getByRole("option")).toContainText(
      "Picker temporarily unavailable",
    );
    await rule.press("ArrowDown");
    await rule.press("Enter");
    await expect(page.getByRole("option")).toHaveText([child.name]);
    expect(searches.filter((search) => search === "retry")).toHaveLength(2);
    await expect(rule).toBeFocused();
    await rule.press("Escape");
    await expect(rule).toHaveValue(child.name);
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
  } finally {
    gate.release();
  }
});

test("reference pickers in the node dialog stage changes and historical pins remain read-only", async ({
  page,
  request,
}) => {
  const { parent, child } = await fixture(request);
  const published = await request.post(`/api/rules/${parent.id}/publish`, {
    data: { revision: parent.revision },
  });
  expect(published.ok()).toBeTruthy();
  await page.goto(`/#/rules/${parent.id}?node=ref`);
  const card = page.locator('.react-flow__node[data-id="ref"] .graph-node');
  const open = async () => {
    await card.click({ button: "right" });
    await page
      .getByRole("menu", { name: "Node actions" })
      .getByRole("menuitem", { name: "Edit", exact: true })
      .click();
    return page.getByRole("dialog", { name: /^Edit node/ });
  };
  let dialog = await open();
  await dialog
    .getByRole("combobox", { name: "Pinned version", exact: true })
    .fill("2");
  await page.getByRole("option", { name: "Version 2", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    sidebar(page).getByRole("combobox", {
      name: "Pinned version",
      exact: true,
    }),
  ).toHaveValue("Version 1");
  await expect(
    sidebar(page).getByLabel("amount *", { exact: true }),
  ).toHaveValue("7");
  dialog = await open();
  await dialog
    .getByRole("combobox", { name: "Published rule", exact: true })
    .fill(child.id);
  await page.getByRole("option", { name: child.name, exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Pinned version", exact: true }),
  ).toHaveValue("Version 1");
  await dialog
    .getByRole("combobox", { name: "Pinned version", exact: true })
    .fill("2");
  await page.getByRole("option", { name: "Version 2", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(
    sidebar(page).getByRole("combobox", {
      name: "Pinned version",
      exact: true,
    }),
  ).toHaveValue("Version 2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await page
    .locator(".version-bar")
    .getByRole("button", { name: /v1/ })
    .click();
  await card.click();
  await expect(
    sidebar(page).getByRole("combobox", {
      name: "Published rule",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    sidebar(page).getByRole("combobox", {
      name: "Pinned version",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    sidebar(page).getByRole("combobox", {
      name: "Pinned version",
      exact: true,
    }),
  ).toHaveValue("Version 1");
});
