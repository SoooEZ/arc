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

for (const scenario of ["current", "reopened", "failed"] as const) {
  test(`source save ${scenario} retains test parameters edited before its response`, async ({
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
      await route.fulfill(
        scenario === "failed"
          ? { status: 409, json: { message: "Source save conflict" } }
          : {
              json: {
                ...first,
                name: payload.name,
                definition: payload.definition,
                version: 3,
              },
            },
      );
      delivered = true;
    });
    let tested: unknown;
    await page.route("**/api/sources/source-a/test", (route) => {
      tested = route.request().postDataJSON();
      return route.fulfill({ json: { result: 42 } });
    });
    page.on("dialog", (dialog) => dialog.accept());
    try {
      await page.goto("/#/sources");
      await page.getByLabel("Name", { exact: true }).fill("Saved A");
      await page.getByRole("button", { name: "Save new version" }).click();
      await expect.poll(() => held).toBe(true);
      if (scenario === "reopened") {
        await page
          .locator(".source-list > button")
          .filter({ hasText: "Source B" })
          .click();
        await page
          .locator(".source-list > button")
          .filter({ hasText: "Source A" })
          .click();
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Source A",
        );
      }
      const input = page.getByLabel("Test parameters · JSON");
      await expect(input).toBeEnabled();
      await input.fill('{"key":"CUSTOM"}');
      gate.release();
      await expect.poll(() => delivered).toBe(true);
      await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
      await expect(input).toHaveValue('{"key":"CUSTOM"}');
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
        "Saved A",
      );
      const save = page.getByRole("button", { name: "Save new version" });
      if (scenario === "failed") {
        await expect(page.getByText("Source save conflict")).toBeVisible();
        await expect(save).toBeEnabled();
        await expect(
          page.getByRole("combobox", { name: "Inspect version" }),
        ).toContainText("v2");
      } else {
        await expect(save).toBeDisabled();
        await expect(
          page.getByRole("combobox", { name: "Inspect version" }),
        ).toContainText("v3");
        await page.getByRole("button", { name: "Fetch sample" }).click();
        await expect(page.getByTestId("source-result")).toHaveText("42");
        expect(tested).toEqual({ version: 3, inputs: { key: "CUSTOM" } });
        await page
          .locator(".source-list > button")
          .filter({ hasText: "Source B" })
          .click();
        await expect(input).toHaveValue(JSON.stringify({ key: "US" }, null, 2));
      }
    } finally {
      gate.release();
    }
  });
}

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
  // Like the server, every read that starts after the creation lists the new source.
  const created: DataSource[] = [];
  await page.route("**/api/sources", (route) => {
    const source = { ...route.request().postDataJSON(), version: 1 };
    created.push(source);
    return route.fulfill({ status: 201, json: source });
  });
  await page.route("**/api/source-summaries?*", async (route) => {
    const listed = [...created, first, second];
    held = true;
    await gate.promise;
    await route.fulfill({ json: summaries(listed) });
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
  const inspect = page.getByRole("combobox", { name: "Inspect version" });
  await expect(inspect).toHaveText("v45 · latest");
  await page
    .getByRole("navigation", { name: "Source history pages" })
    .getByRole("button", { name: "Next" })
    .click();
  // The viewed version is not on the older page, yet keeps the page's wording.
  await expect(inspect).toHaveText("v45 · latest");
  await inspect.click();
  await page.getByRole("option", { name: "v25 · immutable" }).click();
  await expect(page.locator(".source-json")).toContainText('"US": 25');
  expect(details).toEqual([45, 25]);
});

for (const failure of [false, true]) {
  test(`historical source metadata ${failure ? "failure" : "success"} preserves test parameters typed while loading`, async ({
    page,
  }) => {
    await mockWorkspace(page);
    const gate = deferredResponse();
    let held = false;
    const historical = {
      ...first,
      version: 1,
      definition: {
        ...first.definition,
        parameters: first.definition.parameters.map((parameter) => ({
          ...parameter,
          defaultValue: "GB",
        })),
      },
    };
    await page.route("**/api/sources/source-a/versions/1", async (route) => {
      held = true;
      await gate.promise;
      await route.fulfill(
        failure
          ? { status: 503, json: { message: "Historical source unavailable" } }
          : { json: historical },
      );
    });
    let tested: unknown;
    await page.route("**/api/sources/source-a/test", (route) => {
      tested = route.request().postDataJSON();
      return route.fulfill({ json: { result: 42 } });
    });
    try {
      await page.goto("/#/sources");
      await page.getByRole("combobox", { name: "Inspect version" }).click();
      await page.getByRole("option", { name: "v1 · immutable" }).click();
      await expect.poll(() => held).toBe(true);
      const input = page.getByLabel("Test parameters · JSON");
      await input.fill('{"key":"CUSTOM"}');
      gate.release();
      await expect(page.getByLabel("Loading source version")).toHaveCount(0);
      await expect(input).toHaveValue('{"key":"CUSTOM"}');
      const fetchSample = page.getByRole("button", { name: "Fetch sample" });
      if (failure) {
        await expect(
          page.getByText("Historical source unavailable"),
        ).toBeVisible();
        await expect(fetchSample).toBeDisabled();
        expect(tested).toBeUndefined();
      } else {
        await fetchSample.click();
        await expect(page.getByTestId("source-result")).toHaveText("42");
        expect(tested).toEqual({ version: 1, inputs: { key: "CUSTOM" } });

        await page.getByRole("combobox", { name: "Inspect version" }).click();
        await page.getByRole("option", { name: "v2 · latest" }).click();
        await page.getByRole("combobox", { name: "Inspect version" }).click();
        await page.getByRole("option", { name: "v1 · immutable" }).click();
        await expect(input).toHaveValue(JSON.stringify({ key: "GB" }, null, 2));
      }
    } finally {
      gate.release();
    }
  });
}

for (const provider of ["HTTP", "LOOKUP"] as const) {
  test(`saving ${provider} ignores inactive provider JSON and excludes its configuration`, async ({
    page,
  }) => {
    await mockWorkspace(page);
    let saved: DataSource | undefined;
    await page.route("**/api/sources/source-a", (route) => {
      const payload = route.request().postDataJSON();
      saved = { ...first, ...payload, version: 3 };
      return route.fulfill({ json: saved });
    });
    await page.goto("/#/sources");
    const providerField = page.getByRole("combobox", {
      name: "Provider",
      exact: true,
    });
    if (provider === "HTTP") {
      await page
        .getByLabel("Lookup entries · JSON object")
        .fill("{unfinished lookup");
      await providerField.click();
      await page
        .getByRole("option", { name: "HTTP GET · JSON response" })
        .click();
      await page.getByLabel("HTTP URL").fill("https://example.com/source");
      await page
        .getByLabel("Secret header aliases · JSON")
        .fill('{"Authorization":"CRM_TOKEN"}');
    } else {
      await providerField.click();
      await page
        .getByRole("option", { name: "HTTP GET · JSON response" })
        .click();
      await page.getByLabel("HTTP URL").fill("https://example.com/obsolete");
      await page
        .getByLabel("Secret header aliases · JSON")
        .fill("{unfinished headers");
      await providerField.click();
      await page.getByRole("option", { name: "Local lookup table" }).click();
      await page
        .getByLabel("Lookup entries · JSON object")
        .fill('{"US": false}');
    }
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect.poll(() => saved?.version).toBe(3);
    await expect(
      page.getByRole("button", { name: "Save new version" }),
    ).toBeDisabled();
    expect(saved!.definition.kind).toBe(provider);
    if (provider === "HTTP") {
      expect(saved!.definition).not.toHaveProperty("entries");
      expect(saved!.definition.secretHeaders).toEqual({
        Authorization: "CRM_TOKEN",
      });
      expect(saved!.definition.url).toBe("https://example.com/source");
    } else {
      expect(saved!.definition).not.toHaveProperty("url");
      expect(saved!.definition).not.toHaveProperty("secretHeaders");
      expect(saved!.definition.entries).toEqual({ US: false });
    }
  });
}

test("a new source ID follows the shared resource ID policy", async ({
  page,
}) => {
  await mockWorkspace(page);
  const posted: { id: string }[] = [];
  await page.route("**/api/sources", (route) => {
    const payload = route.request().postDataJSON();
    posted.push(payload);
    return route.fulfill({ status: 201, json: { ...payload, version: 1 } });
  });
  await page.goto("/#/sources");
  await expect(page.getByLabel("Source ID")).toHaveValue("source-a");
  await page.getByRole("button", { name: "New source" }).click();
  const id = page.getByLabel("Source ID");
  const create = page.getByRole("button", { name: "Create source" });
  await page.getByLabel("Name", { exact: true }).fill("Customer profile");
  await expect(create).toBeDisabled();
  for (const refused of [
    "Customer Profile",
    "customer_profile",
    "1st-source",
    "customer profile",
  ]) {
    await id.fill(refused);
    await expect(id).toHaveValue("");
    await expect(id).toHaveAttribute("aria-invalid", "true");
  }
  await expect(
    page.getByText(/lowercase letters, digits and hyphens/),
  ).toBeVisible();
  await id.fill("customer-profile");
  await expect(id).toHaveAttribute("aria-invalid", "false");
  await expect(create).toBeEnabled();
  await create.click();
  await expect
    .poll(() => posted)
    .toEqual([expect.objectContaining({ id: "customer-profile" })]);
});

test("the HTTP timeout keeps typed text and blocks values the server rejects", async ({
  page,
}) => {
  await mockWorkspace(page);
  const saved: { definition: { kind: string; timeoutMs: number } }[] = [];
  await page.route("**/api/sources/source-a", (route) => {
    const payload = route.request().postDataJSON();
    saved.push(payload);
    return route.fulfill({
      json: {
        ...first,
        name: payload.name,
        definition: payload.definition,
        version: 3,
      },
    });
  });
  await page.goto("/#/sources");
  await expect(page.getByLabel("Source ID")).toHaveValue("source-a");
  await page.getByLabel("Provider").click();
  await page.getByRole("option", { name: "HTTP GET · JSON response" }).click();
  // Source parameters are scalar; the helper lists only accepted types.
  await expect(
    page.getByText(
      "Declare name, type (STRING / NUMBER / BOOLEAN), required, and optional defaultValue.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText(/ARRAY \/ OBJECT/)).toHaveCount(0);
  await page.getByLabel("HTTP URL").fill("https://example.com/customer");
  const timeout = page.getByLabel("Timeout (ms)");
  const save = page.getByRole("button", { name: "Save new version" });
  await expect(timeout).toHaveValue("3000");
  await timeout.fill("");
  await expect(timeout).toHaveValue("");
  await expect(timeout).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Enter whole milliseconds from 100 to 10,000."),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await timeout.pressSequentially("5000");
  await expect(timeout).toHaveValue("5000");
  await expect(timeout).toHaveAttribute("aria-invalid", "false");
  for (const rejected of ["50", "20000", "1e3", "-"]) {
    await timeout.fill(rejected);
    await expect(timeout).toHaveValue(rejected);
    await expect(save).toBeDisabled();
  }
  await timeout.fill("250");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].definition).toMatchObject({ kind: "HTTP", timeoutMs: 250 });
});

test("a new draft that takes a pending create's ID stays its own and receives the server's 409", async ({
  page,
}) => {
  await mockWorkspace(page);
  const gate = deferredResponse();
  const posts: string[] = [];
  let puts = 0;
  await page.route("**/api/sources", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const payload = route.request().postDataJSON();
    posts.push(payload.name);
    if (posts.length === 1) {
      await gate.promise;
      await route.fulfill({ json: { ...payload, version: 1 } });
      return;
    }
    await route.fulfill({
      status: 409,
      json: { message: "This source ID already exists" },
    });
  });
  await page.route("**/api/sources/held-create", (route) => {
    puts++;
    return route.fulfill({ json: {} });
  });
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto("/#/sources");
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Source ID").fill("held-create");
    await page.getByLabel("Name", { exact: true }).fill("First table");
    await page.getByRole("button", { name: "Create source" }).click();
    await expect.poll(() => posts.length).toBe(1);
    // A second New source while the create is pending: unrelated content, the same ID.
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Other table");
    await page.getByLabel("Lookup entries · JSON object").fill('{"FR":1}');
    await page.getByLabel("Source ID").fill("held-create");
    // The pending create belongs to the discarded draft, not to this one.
    await expect(page.getByLabel("Source ID")).toBeEnabled();
    gate.release();
    await expect(
      page.locator(".source-list > button").filter({ hasText: "First table" }),
    ).toBeVisible();
    // Before, this draft became "v1 · edited" here and Save sent a PUT for first v2.
    await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Source ID")).toBeEnabled();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Other table",
    );
    await page.getByRole("button", { name: "Create source" }).click();
    await expect(
      page.getByText("This source ID already exists", { exact: true }),
    ).toBeVisible();
    expect(posts).toEqual(["First table", "Other table"]);
    expect(puts).toBe(0);
  } finally {
    gate.release();
  }
});

test("switching the provider away and back leaves an unchanged source clean", async ({
  page,
}) => {
  await mockWorkspace(page);
  const country: DataSource = {
    ...first,
    definition: {
      ...first.definition,
      parameters: [
        { name: "country", type: "STRING", required: true, defaultValue: null },
      ],
    },
  };
  await page.route("**/api/sources/source-a/versions/*", (route) =>
    route.fulfill({ json: country }),
  );
  await page.goto("/#/sources");
  await expect(page.getByLabel("Source ID")).toHaveValue("source-a");
  const parameters = page.getByLabel("Source parameters · JSON");
  await expect(parameters).toHaveValue(/country/);
  const save = page.getByRole("button", { name: "Save new version" });
  await expect(save).toBeDisabled();
  const provider = page.getByRole("combobox", { name: "Provider" });
  await provider.click();
  await page.getByRole("option", { name: "HTTP GET · JSON response" }).click();
  await expect(parameters).toHaveValue(/customerId/);
  await expect(save).toBeEnabled();
  // The round trip used to leave the LOOKUP template, an edit the user never made.
  await provider.click();
  await page.getByRole("option", { name: "Local lookup table" }).click();
  await expect(parameters).toHaveValue(/country/);
  await expect(save).toBeDisabled();
});

test("a failed catalog read offers Retry without a close button, while document errors stay dismissible", async ({
  page,
}) => {
  await mockWorkspace(page);
  let failures = 1;
  await page.route("**/api/source-summaries?*", (route) => {
    if (failures > 0) {
      failures -= 1;
      return route.fulfill({
        status: 500,
        json: { message: "Catalog is down" },
      });
    }
    return route.fallback();
  });
  await page.goto("/#/sources");
  const catalogAlert = page
    .getByRole("alert")
    .filter({ hasText: "Could not load data sources: Catalog is down" });
  await expect(catalogAlert).toBeVisible();
  // The one dismissible alert hid the failure behind its close button, with no way to retry.
  await expect(catalogAlert.getByRole("button", { name: "Close" })).toHaveCount(
    0,
  );
  await catalogAlert
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Source A/ })).toBeVisible();
  await expect(catalogAlert).toHaveCount(0);
  await expect(page.getByLabel("Source ID")).toHaveValue("source-a");
  await page.route("**/api/sources/source-a", (route) =>
    route.fulfill({ status: 500, json: { message: "Save exploded" } }),
  );
  await page.getByLabel("Name", { exact: true }).fill("Source A renamed");
  await page.getByRole("button", { name: "Save new version" }).click();
  const saveAlert = page
    .getByRole("alert")
    .filter({ hasText: "Save exploded" });
  await expect(saveAlert).toBeVisible();
  await saveAlert.getByRole("button", { name: "Close" }).click();
  await expect(saveAlert).toHaveCount(0);
});
