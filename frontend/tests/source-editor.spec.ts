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

async function mockWorkspace(page: Page) {
  await page.route("**/api/rules", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sources", (route) =>
    route.fulfill({ json: [first, second] }),
  );
  await page.route("**/api/sources/*/versions", (route) => {
    const selected = route.request().url().includes("source-a")
      ? first
      : second;
    return route.fulfill({ json: [selected, { ...selected, version: 1 }] });
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
      .locator(".source-list button")
      .filter({ hasText: "Source B" })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Unsaved B");
    await page.getByLabel("Lookup entries · JSON object").fill('{"US":42}');
    gate.release();
    await expect.poll(() => delivered).toBe(true);
    await expect(
      page.locator(".source-list button").filter({ hasText: "Saved A" }),
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
          .locator(".source-list button")
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
  await page.route("**/api/sources", async (route) => {
    held = true;
    await gate.promise;
    await route.fulfill({ json: [first, second] });
  });
  try {
    await page.goto("/#/sources");
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Source ID").fill("new-draft");
    await page.getByLabel("Name", { exact: true }).fill("New draft");
    gate.release();
    await expect(page.locator(".source-list button")).toHaveCount(2);
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
      .locator(".source-list button")
      .filter({ hasText: "Source B" })
      .click();
    await page
      .locator(".source-list button")
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
      .locator(".source-list button")
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
  await page.route("**/api/sources", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        json: { ...route.request().postDataJSON(), version: 1 },
      });
      return;
    }
    held = true;
    await gate.promise;
    await route.fulfill({ json: [first, second] });
  });
  await page.route("**/api/sources/created/versions", (route) =>
    route.fulfill({
      json: [{ ...source("created", "Created during load"), version: 1 }],
    }),
  );
  try {
    await page.goto("/#/sources");
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "New source" }).click();
    await page.getByLabel("Source ID").fill("created");
    await page.getByLabel("Name", { exact: true }).fill("Created during load");
    await page.getByRole("button", { name: "Create source" }).click();
    await expect(page.locator(".source-list button")).toHaveCount(1);
    gate.release();
    await expect(page.locator(".source-list button")).toHaveCount(3);
    await expect(
      page
        .locator(".source-list button")
        .filter({ hasText: "Created during load" }),
    ).toBeVisible();
    await expect(page.getByLabel("Source ID")).toHaveValue("created");
  } finally {
    gate.release();
  }
});
