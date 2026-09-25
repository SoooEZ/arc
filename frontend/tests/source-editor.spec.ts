import { expect, test, type Page } from "@playwright/test";
import type { DataSource } from "../src/types";

function source(id: string, name: string): DataSource {
  return {
    id,
    name,
    version: 2,
    definition: {
      kind: "LOOKUP",
      parameters: [
        { name: "key", type: "STRING", required: true, defaultValue: null },
      ],
      entries: { US: 10 },
      timeoutMs: 3000,
    },
  };
}
const first = source("source-a", "Source A");
const second = source("source-b", "Source B");

const summaries = (rows: DataSource[]) => ({
  items: rows.map(({ id, name, version, definition }) => ({
    id,
    name,
    version,
    kind: definition.kind,
  })),
  total: rows.length,
  offset: 0,
  limit: 20,
});
async function mockWorkspace(page: Page) {
  await page.route("**/api/rule-summaries?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.route("**/api/source-summaries?*", (route) =>
    route.fulfill({ json: summaries([first, second]) }),
  );
  await page.route("**/api/sources/*/version-summaries?*", (route) => {
    const selected = route.request().url().includes("source-a")
      ? first
      : second;
    return route.fulfill({
      json: {
        items: [selected, { ...selected, version: 1 }].map(
          ({ id, version }) => ({
            id,
            version,
            createdAt: "2026-09-24T00:00:00Z",
          }),
        ),
        total: 2,
        offset: 0,
        limit: 20,
      },
    });
  });
  await page.route("**/api/sources/*/versions/*", (route) => {
    const url = new URL(route.request().url());
    const selected = url.pathname.includes("source-a") ? first : second;
    return route.fulfill({
      json: { ...selected, version: Number(url.pathname.split("/").at(-1)) },
    });
  });
}

function deferredResponse() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("saving A preserves the selection and edits of B when A completes", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  let delivered = false;
  await page.route("**/api/sources/source-a", async (route) => {
    held = true;
    const payload = route.request().postDataJSON();
    await gate.promise;
    await route.fulfill({
      json: {
        ...first,
        name: payload.name,
        definition: payload.definition,
        version: 3,
      },
    });
    delivered = true;
  });
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto("/#/sources");
    await page.getByLabel("Name", { exact: true }).fill("Saved A");
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect.poll(() => held).toBe(true);
    await page
      .locator(".source-list > button")
      .filter({ hasText: "Source B" })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Unsaved B");
    await page.getByLabel("Lookup entries · JSON object").fill('{"US":42}');
    gate.release();
    await expect.poll(() => delivered).toBe(true);
    await expect(
      page.locator(".source-list > button").filter({ hasText: "Saved A" }),
    ).toContainText("v3");
    await expect(page.getByLabel("Source ID")).toHaveValue("source-b");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Unsaved B",
    );
    await expect(page.getByLabel("Lookup entries · JSON object")).toHaveValue(
      '{"US":42}',
    );
    await expect(
      page.getByRole("button", { name: "Save new version" }),
    ).toBeEnabled();
  } finally {
    gate.release();
  }
});

for (const change of ["source", "version", "input"] as const) {
  test(`a source test ignores late results after changing ${change}`, async ({
    page,
  }) => {
    await mockWorkspace(page);
    const gate = deferredResponse();
    let held = false;
    let delivered = false;
    await page.route("**/api/sources/*/test", async (route) => {
      held = true;
      await gate.promise;
      await route.fulfill({ json: { result: "OUTDATED RESULT" } });
      delivered = true;
    });
    try {
      await page.goto("/#/sources");
      const response = page.waitForResponse("**/api/sources/source-a/test");
      await page.getByRole("button", { name: "Fetch sample" }).click();
      await expect.poll(() => held).toBe(true);
      if (change === "source")
        await page
          .locator(".source-list > button")
          .filter({ hasText: "Source B" })
          .click();
      if (change === "version") {
        await page.getByRole("combobox", { name: "Inspect version" }).click();
        await page.getByRole("option", { name: "v1 · immutable" }).click();
      }
      if (change === "input")
        await page.getByLabel("Test parameters · JSON").fill('{"key":"GB"}');
      gate.release();
      await expect.poll(() => delivered).toBe(true);
      await response;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.getByTestId("source-result")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Fetch sample" }),
      ).toBeEnabled();
    } finally {
      gate.release();
    }
  });
}

test("a delayed initial source list cannot overwrite a newly started source", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  await page.route("**/api/source-summaries?*", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({ json: summaries([first, second]) });
  });
  try {
    await page.goto("/#/sources");
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Source ID").fill("new-draft");
    await page.getByLabel("Name", { exact: true }).fill("New draft");
    gate.release();
    await expect(page.locator(".source-list > button")).toHaveCount(2);
    await expect(page.getByLabel("Source ID")).toHaveValue("new-draft");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "New draft",
    );
  } finally {
    gate.release();
  }
});

test("a failed save finishes after leaving and reopening the same source", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  await page.route("**/api/sources/source-a", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({
      status: 409,
      json: { message: "Original save failed" },
    });
  });
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto("/#/sources");
    await page.getByLabel("Name", { exact: true }).fill("Saved A");
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/sources/source-a") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect.poll(() => held).toBe(true);
    await page
      .locator(".source-list > button")
      .filter({ hasText: "Source B" })
      .click();
    await page
      .locator(".source-list > button")
      .filter({ hasText: "Source A" })
      .click();
    await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
    gate.release();
    await response;
    await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Source A",
    );
    await expect(
      page.getByText("Original save failed", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Retry draft");
    await expect(
      page.getByRole("button", { name: "Save new version" }),
    ).toBeEnabled();
  } finally {
    gate.release();
  }
});

test("a failed source test cannot mark another selected source", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  await page.route("**/api/sources/source-a/test", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({
      status: 422,
      json: { message: "Outdated source error" },
    });
  });
  try {
    await page.goto("/#/sources");
    const response = page.waitForResponse("**/api/sources/source-a/test");
    await page.getByRole("button", { name: "Fetch sample" }).click();
    await expect.poll(() => held).toBe(true);
    await page
      .locator(".source-list > button")
      .filter({ hasText: "Source B" })
      .click();
    gate.release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByText("Outdated source error", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Fetch sample" }),
    ).toBeEnabled();
  } finally {
    gate.release();
  }
});

test("an old source list retains a source created while that list was loading", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  await page.route("**/api/sources", (route) =>
    route.fulfill({
      status: 201,
      json: { ...route.request().postDataJSON(), version: 1 },
    }),
  );
  await page.route("**/api/source-summaries?*", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({ json: summaries([first, second]) });
  });
  await page.route("**/api/sources/created/version-summaries?*", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "created", version: 1, createdAt: "2026-09-24T00:00:00Z" },
        ],
        total: 1,
        offset: 0,
        limit: 20,
      },
    }),
  );
  try {
    await page.goto("/#/sources");
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Source ID").fill("created");
    await page.getByLabel("Name", { exact: true }).fill("Created during load");
    await page.getByRole("button", { name: "Create source" }).click();
    await expect(page.locator(".source-list > button")).toHaveCount(1);
    gate.release();
    await expect(page.locator(".source-list > button")).toHaveCount(3);
    await expect(
      page
        .locator(".source-list > button")
        .filter({ hasText: "Created during load" }),
    ).toBeVisible();
    await expect(page.getByLabel("Source ID")).toHaveValue("created");
  } finally {
    gate.release();
  }
});

test("a late selected source detail cannot replace another source's edits", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  let held = false;
  await page.route("**/api/sources/source-a/versions/2", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({ json: first });
  });
  try {
    await page.goto("/#/sources");
    await expect.poll(() => held).toBe(true);
    await page
      .locator(".source-list > button")
      .filter({ hasText: "Source B" })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Newer B edit");
    gate.release();
    await expect(page.getByLabel("Source ID")).toHaveValue("source-b");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Newer B edit",
    );
  } finally {
    gate.release();
  }
});

test("source catalog pages keep the open editor and fetch only a chosen configuration", async ({
  page,
}) => {
  await mockWorkspace(page);
  const rows = Array.from({ length: 25 }, (_, index) =>
    source(`table-${index}`, `Table ${index}`),
  );
  await page.route("**/api/source-summaries?*", (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") || 0);
    const search = url.searchParams.get("search") || "";
    const matching = rows.filter((row) => row.name.includes(search));
    return route.fulfill({
      json: {
        ...summaries(matching.slice(offset, offset + 20)),
        total: matching.length,
        offset,
      },
    });
  });
  await page.route("**/api/sources/table-*/versions/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({ json: rows.find((row) => row.id === id) });
  });
  const details: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/sources\/table-\d+\/versions\/\d+$/.test(request.url()))
      details.push(request.url());
  });
  await page.goto("/#/sources");
  await expect(page.locator(".source-list > button")).toHaveCount(20);
  await expect(page.getByLabel("Source ID")).toHaveValue("table-0");
  expect(details).toHaveLength(1);
  await page
    .getByRole("navigation", { name: "Data sources pages" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.locator(".source-list > button")).toHaveCount(5);
  await expect(page.getByLabel("Source ID")).toHaveValue("table-0");
  expect(details).toHaveLength(1);
  await page
    .locator(".source-list > button")
    .filter({ hasText: "Table 24" })
    .click();
  await expect(page.getByLabel("Source ID")).toHaveValue("table-24");
  expect(details).toHaveLength(2);
  await page.getByLabel("Search data sources").fill("Table 3");
  await expect(page.locator(".source-list > button")).toHaveCount(1);
  await expect(page.getByLabel("Source ID")).toHaveValue("table-24");
  expect(details).toHaveLength(2);
});

test("source history pages load only the inspected version definition", async ({
  page,
}) => {
  await mockWorkspace(page);
  const current = { ...first, version: 45 };
  await page.route("**/api/source-summaries?*", (route) =>
    route.fulfill({ json: summaries([current]) }),
  );
  await page.route("**/api/sources/source-a/version-summaries?*", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset") || 0,
    );
    return route.fulfill({
      json: {
        items: Array.from({ length: 45 }, (_, index) => ({
          id: current.id,
          version: 45 - index,
          createdAt: "2026-09-24T00:00:00Z",
        })).slice(offset, offset + 20),
        total: 45,
        offset,
        limit: 20,
      },
    });
  });
  const details: number[] = [];
  await page.route("**/api/sources/source-a/versions/*", (route) => {
    const version = Number(
      new URL(route.request().url()).pathname.split("/").at(-1),
    );
    details.push(version);
    return route.fulfill({
      json: {
        ...current,
        version,
        definition: { ...current.definition, entries: { US: version } },
      },
    });
  });
  await page.goto("/#/sources");
  await expect(page.getByLabel("Source ID")).toHaveValue("source-a");
  expect(details).toEqual([45]);
  await page
    .getByRole("navigation", { name: "Source history pages" })
    .getByRole("button", { name: "Next" })
    .click();
  await page.getByRole("combobox", { name: "Inspect version" }).click();
  await page.getByRole("option", { name: "v25 · immutable" }).click();
  await expect(page.locator(".source-json")).toContainText('"US": 25');
  expect(details).toEqual([45, 25]);
});
