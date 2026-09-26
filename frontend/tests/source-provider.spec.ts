import { expect, test, type Page } from "@playwright/test";
import type { DataSource, Rule } from "../src/types";

const providers: DataSource[] = Array.from({ length: 45 }, (_, index) => ({
  id: index === 0 ? "caller" : `provider-${index}`,
  name: `Provider ${String(index).padStart(2, "0")}`,
  version: 2,
  definition: {
    kind: "LOOKUP",
    parameters: [
      { name: "key", type: "STRING", required: true, defaultValue: null },
    ],
    entries: { US: index },
    timeoutMs: 3000,
  },
}));

async function fixture(page: Page) {
  let rule: Rule = {
    id: "provider-picker",
    name: "Provider picker",
    description: "",
    kind: "FORMULA",
    revision: 1,
    publishedVersion: null,
    createdAt: "2026-09-25T00:00:00Z",
    updatedAt: "2026-09-25T00:00:00Z",
    draft: {
      schemaVersion: 1,
      inputs: [
        {
          name: "amount",
          type: "NUMBER",
          required: true,
          defaultValue: 7,
          source: {
            id: "provider-24",
            version: 1,
            bindings: { key: '"US"' },
            pointer: "/amount",
            onError: "DEFAULT",
          },
        },
      ],
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
          label: "Output",
          expression: "amount",
          position: { x: 200, y: 200 },
        },
      ],
      edges: [
        { id: "next", source: "input", target: "out", sourceHandle: "next" },
      ],
    },
  };
  const reads: { search: string; offset: number; limit: number }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/rule-summaries") {
      const { draft, ...metadata } = rule;
      return route.fulfill({
        json: {
          items: [
            {
              ...metadata,
              nodeCount: draft.nodes.length,
              inputCount: 1,
              referenceCount: 0,
            },
          ],
          total: 1,
          offset: 0,
          limit: 20,
        },
      });
    }
    if (url.pathname === `/api/rules/${rule.id}`) {
      if (route.request().method() === "PUT")
        rule = {
          ...rule,
          draft: route.request().postDataJSON().definition,
          revision: rule.revision + 1,
        };
      return route.fulfill({ json: rule });
    }
    if (url.pathname === "/api/source-summaries") {
      const search = url.searchParams.get("search") || "";
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      reads.push({ search, offset, limit });
      const matching = providers.filter((item) =>
        `${item.id} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
      );
      return route.fulfill({
        json: {
          items: matching
            .slice(offset, offset + limit)
            .map(({ definition, ...source }) => ({
              ...source,
              kind: definition.kind,
            })),
          total: matching.length,
          offset,
          limit,
        },
      });
    }
    const detail = /^\/api\/sources\/([^/]+)\/versions\/(\d+)$/.exec(
      url.pathname,
    );
    if (detail)
      return route.fulfill({
        json: {
          ...providers.find((source) => source.id === detail[1]),
          version: Number(detail[2]),
        },
      });
    if (url.pathname.endsWith("/version-summaries"))
      return route.fulfill({
        json: {
          items: [2, 1].map((version) => ({
            version,
            id: url.pathname.split("/")[3],
            createdAt: "2026-09-25T00:00:00Z",
          })),
          total: 2,
          offset: 0,
          limit: 20,
        },
      });
    if (url.pathname === "/api/studio/render")
      return route.fulfill({ json: { source: "" } });
    if (url.pathname === "/api/variables")
      return route.fulfill({ json: { input: ["amount"], out: ["amount"] } });
    return route.fulfill({ json: [] });
  });
  return { reads, saved: () => rule };
}

test("each provider picker searches bounded pages, keeps keyboard text and preserves its immutable pin", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/#/rules/provider-picker?node=input");
  const picker = page.getByRole("combobox", {
    name: "Value provider",
    exact: true,
  });
  await expect(picker).toHaveValue("Provider 24");
  expect(state.reads).toEqual([]);
  await expect(
    page.getByLabel("Find value provider", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Value providers pages" }),
  ).toHaveCount(0);
  const before = await page.locator(".input-schema-card").boundingBox();
  await picker.focus();
  await picker.press("ControlOrMeta+a");
  await picker.press("P");
  await expect(picker).toHaveValue("P");
  await expect
    .poll(() => state.reads.some((query) => query.search === "P"))
    .toBe(true);
  await picker.fill("Provider 24");
  await page.getByRole("option", { name: "Provider 24", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Source version", exact: true }),
  ).toHaveText("v1");
  await expect(page.getByLabel("Source key", { exact: true })).toHaveValue(
    "US",
  );
  await expect(page.getByLabel("JSON pointer", { exact: true })).toHaveValue(
    "/amount",
  );
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await picker.click();
  await expect(
    page.getByRole("option", { name: "More providers", exact: true }),
  ).toBeVisible();
  await picker.press("End");
  await picker.press("Enter");
  await expect(
    page.getByRole("option", { name: "Provider 39", exact: true }),
  ).toBeVisible();
  expect(
    state.reads.some((query) => query.offset === 20 && query.search === ""),
  ).toBe(true);
  await picker.fill("provider-44");
  await expect(
    page.getByRole("option", { name: "Provider 44", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveValue("Provider 24");
  const after = await page.locator(".input-schema-card").boundingBox();
  expect(after?.height).toBe(before?.height);
  await picker.click();
  await picker.fill("provider-44");
  await page.getByRole("option", { name: "Provider 44", exact: true }).click();
  await expect(picker).toHaveValue("Provider 44");
  await expect(
    page.getByRole("combobox", { name: "Source version", exact: true }),
  ).toHaveText("v2");
  await picker.click();
  await page
    .getByRole("option", { name: "Caller / default value", exact: true })
    .click();
  await expect(picker).toHaveValue("Caller / default value");
  await expect(
    page.getByRole("combobox", { name: "Source version", exact: true }),
  ).toHaveCount(0);
  expect(state.reads.every((query) => query.limit === 20)).toBe(true);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(state.saved().draft.inputs[0].source).toBeNull();
});

test("late search success and search errors cannot replace newer results or clear a pinned provider", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/source-summaries?*", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search === "Provider 2") {
      held = true;
      await gate;
    }
    if (search === "broken")
      return route.fulfill({
        status: 503,
        json: { message: "Provider search unavailable" },
      });
    await route.fallback();
  });
  try {
    await page.goto("/#/rules/provider-picker?node=input");
    const picker = page.getByRole("combobox", {
      name: "Value provider",
      exact: true,
    });
    await expect(picker).toHaveValue("Provider 24");
    await picker.fill("Provider 2");
    await expect.poll(() => held).toBe(true);
    await picker.fill("Provider 44");
    await expect(
      page.getByRole("option", { name: "Provider 44", exact: true }),
    ).toBeVisible();
    release();
    await expect(
      page.getByRole("option", { name: "Provider 20", exact: true }),
    ).toHaveCount(0);
    await picker.fill("broken");
    await expect(
      page.getByRole("option", {
        name: "Provider search unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveValue("Provider 24");
    await expect(
      page.getByRole("combobox", { name: "Source version", exact: true }),
    ).toHaveText("v1");
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
});

test("nested source management keeps its staged parent and blocks closing during any pending save", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/sources/caller", async (route) => {
    held = true;
    await gate;
    const payload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...providers[0],
        name: payload.name,
        definition: payload.definition,
        version: 3,
      },
    });
  });
  try {
    await page.goto("/#/rules/provider-picker?node=input");
    await page
      .locator('.react-flow__node[data-id="input"] .graph-node')
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const parent = page.getByRole("dialog", { name: /Edit node/ });
    await parent
      .getByLabel("Parameter name", { exact: true })
      .fill("stagedAmount");
    await parent
      .getByRole("button", { name: "Manage data sources", exact: true })
      .click();
    let manager = page.getByRole("dialog", {
      name: "Manage data sources",
      exact: true,
    });
    await expect(manager).toBeVisible();
    await expect(manager.getByLabel("Source ID", { exact: true })).toHaveValue(
      "caller",
    );
    await page.keyboard.press("Escape");
    await expect(manager).toHaveCount(0);
    await expect(parent).toBeVisible();
    await expect(
      parent.getByLabel("Parameter name", { exact: true }),
    ).toHaveValue("stagedAmount");
    await parent
      .getByRole("button", { name: "Manage data sources", exact: true })
      .click();
    manager = page.getByRole("dialog", {
      name: "Manage data sources",
      exact: true,
    });
    await manager
      .getByLabel("Name", { exact: true })
      .fill("Saved first provider");
    await manager
      .getByRole("button", { name: "Save new version", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    page.once("dialog", (dialog) => dialog.accept());
    await manager
      .locator(".source-list > button")
      .filter({ hasText: "Provider 01" })
      .click();
    await expect(manager.getByLabel("Source ID", { exact: true })).toHaveValue(
      "provider-1",
    );
    await manager.getByLabel("Name", { exact: true }).fill("Keep second edit");
    await expect(
      manager.getByRole("button", { name: "Close data sources", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(manager).toBeVisible();
    release();
    await expect(
      manager.getByRole("button", { name: "Close data sources", exact: true }),
    ).toBeEnabled();
    await expect(manager.getByLabel("Name", { exact: true })).toHaveValue(
      "Keep second edit",
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await manager
      .getByRole("button", { name: "Close data sources", exact: true })
      .click();
    await expect(manager).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await manager
      .getByRole("button", { name: "Close data sources", exact: true })
      .click();
    await expect(manager).toHaveCount(0);
    await expect(
      parent.getByLabel("Parameter name", { exact: true }),
    ).toHaveValue("stagedAmount");
    await parent.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.locator(".inspector").getByLabel("Parameter name", { exact: true }),
    ).toHaveValue("amount");
    await expect(page).toHaveURL(/#\/rules\/provider-picker\?node=input$/);
  } finally {
    release();
  }
});

test("source manager creates, versions and tests providers without losing the parent rule or invalid JSON buffer", async ({
  page,
  request,
}, testInfo) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sourceId = `managed-${stamp}`;
  const sourceName = `Managed provider ${stamp}`;
  const createdSource = await request.post("/api/sources", {
    data: {
      id: sourceId,
      name: sourceName,
      definition: {
        kind: "LOOKUP",
        parameters: [
          { name: "key", type: "STRING", required: true, defaultValue: null },
        ],
        entries: { US: 9 },
        timeoutMs: 3000,
      },
    },
  });
  expect(createdSource.ok()).toBeTruthy();
  const ruleId = `source-manager-${stamp}`;
  const created = await request.post("/api/rules", {
    data: {
      id: ruleId,
      name: ruleId,
      kind: "FORMULA",
      definition: {
        schemaVersion: 1,
        inputs: [
          { name: "payload", type: "ARRAY", required: false, defaultValue: [] },
          {
            name: "amount",
            type: "NUMBER",
            required: true,
            defaultValue: 1,
            source: {
              id: sourceId,
              version: 1,
              bindings: { key: '"US"' },
              pointer: "",
              onError: "FAIL",
            },
          },
        ],
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
            expression: "amount",
            position: { x: 200, y: 200 },
          },
        ],
        edges: [
          { id: "next", source: "input", target: "out", sourceHandle: "next" },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/#/rules/${ruleId}?node=input`);
  await page
    .getByLabel("Default JSON (optional)", { exact: true })
    .fill("[unfinished");
  const card = page.locator(".input-schema-card").nth(1);
  await card
    .getByRole("button", { name: "Manage data sources", exact: true })
    .click();
  const manager = page.getByRole("dialog", {
    name: "Manage data sources",
    exact: true,
  });
  await manager
    .getByLabel("Search data sources", { exact: true })
    .fill(sourceName);
  await manager
    .locator(".source-list > button")
    .filter({ hasText: sourceName })
    .click();
  await expect(manager.getByLabel("Source ID", { exact: true })).toHaveValue(
    sourceId,
  );
  await expect(page).toHaveURL(new RegExp(`#/rules/${ruleId}\\?node=input$`));
  const renamed = `Updated ${sourceName}`;
  await manager.getByLabel("Name", { exact: true }).fill(renamed);
  await manager
    .getByLabel("Lookup entries · JSON object", { exact: true })
    .fill('{"US":12}');
  page.once("dialog", (dialog) => dialog.dismiss());
  await manager
    .getByRole("button", { name: "Close data sources", exact: true })
    .click();
  await expect(manager).toBeVisible();
  await manager
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(
    manager.getByRole("combobox", { name: "Inspect version", exact: true }),
  ).toHaveText("v2 · latest");
  await manager
    .getByRole("button", { name: "Fetch sample", exact: true })
    .click();
  await expect(manager.locator(".source-test pre")).toHaveText("12");
  await manager
    .getByRole("combobox", { name: "Inspect version", exact: true })
    .click();
  await page
    .getByRole("option", { name: "v1 · immutable", exact: true })
    .click();
  await expect(manager.locator(".source-detail > .source-json")).toContainText(
    '"US": 9',
  );
  await manager
    .getByRole("combobox", { name: "Inspect version", exact: true })
    .click();
  await page.getByRole("option", { name: "v2 · latest", exact: true }).click();
  await expect(page.locator(".MuiMenu-root")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("source-manager-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await manager.locator(".source-detail").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("source-manager-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await manager
    .getByRole("button", { name: "New source", exact: true })
    .click();
  const newName = `Created inside manager ${stamp}`;
  await manager
    .getByLabel("Source ID", { exact: true })
    .fill(`created-${stamp}`);
  await manager.getByLabel("Name", { exact: true }).fill(newName);
  await manager
    .getByRole("button", { name: "Create source", exact: true })
    .click();
  await expect(
    manager.getByRole("combobox", { name: "Inspect version", exact: true }),
  ).toHaveText("v1 · latest");
  await manager
    .getByRole("button", { name: "Close data sources", exact: true })
    .click();
  await expect(manager).toHaveCount(0);
  await expect(
    page.getByLabel("Default JSON (optional)", { exact: true }),
  ).toHaveValue("[unfinished");
  await expect(
    card.getByRole("combobox", { name: "Source version", exact: true }),
  ).toHaveText("v1");
  await expect(card.getByLabel("Source key", { exact: true })).toHaveValue(
    "US",
  );
  const picker = card.getByRole("combobox", {
    name: "Value provider",
    exact: true,
  });
  await expect(picker).toHaveValue(renamed);
  await picker.fill(newName);
  await expect(
    page.getByRole("option", { name: newName, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("source-provider-search-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("option", { name: newName, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("source-provider-search-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await expect(picker).toHaveValue(renamed);
  await expect(
    card.getByRole("combobox", { name: "Source version", exact: true }),
  ).toHaveText("v1");
  const unchanged = await (await request.get(`/api/rules/${ruleId}`)).json();
  expect(unchanged.revision).toBe(1);
  expect(unchanged.draft.inputs[0].defaultValue).toEqual([]);
  expect(unchanged.draft.inputs[1].source.version).toBe(1);
});
