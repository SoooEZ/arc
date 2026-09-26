import { expect, test, type Page } from "@playwright/test";
import type { Definition, RuleSummary } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const ruleId = "catalog-pricing";
const publishedAt = "2026-09-25T12:00:00Z";

function summary(id: string, version: number): RuleSummary {
  return {
    id,
    name: id === ruleId ? "Catalog pricing" : `Other rule ${id}`,
    description: "",
    kind: "FORMULA",
    revision: version,
    publishedVersion: version,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    nodeCount: 2,
    inputCount: 1,
    referenceCount: 0,
  };
}

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "output",
      type: "OUTPUT",
      label: "Result",
      position: { x: 0, y: 100 },
      expression: "amount",
    },
  ],
  edges: [
    { id: "next", source: "input", target: "output", sourceHandle: "next" },
  ],
};

async function mockCatalog(
  page: Page,
  parentIncludesRule: boolean,
  initialVersion: number,
) {
  const otherRules = Array.from({ length: 20 }, (_, index) =>
    summary(`other-${index}`, 1),
  );
  const parentRules = parentIncludesRule
    ? [summary(ruleId, 1), ...otherRules.slice(1)]
    : otherRules;
  const state = {
    version: initialVersion,
    historyVersion: null as number | null,
    failCatalogOnce: false,
    executionError: false,
    executions: [] as { version: number; inputs: Record<string, unknown> }[],
    unexpected: [] as string[],
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    if (url.pathname === "/api/rule-summaries") {
      const publishedOnly = url.searchParams.get("publishedOnly") === "true";
      if (publishedOnly && state.failCatalogOnce) {
        state.failCatalogOnce = false;
        await route.fulfill({
          status: 503,
          json: { message: "Catalog temporarily unavailable" },
        });
        return;
      }
      await route.fulfill({
        json: {
          items: publishedOnly ? [summary(ruleId, state.version)] : parentRules,
          total: publishedOnly ? 1 : 40,
          offset,
          limit,
        },
      });
      return;
    }
    if (url.pathname === `/api/rules/${ruleId}/version-summaries`) {
      const newestVersion = state.historyVersion ?? state.version;
      const items = Array.from({ length: newestVersion }, (_, index) => ({
        ruleId,
        version: newestVersion - index,
        publishedAt,
      }));
      await route.fulfill({
        json: {
          items: items.slice(offset, offset + limit),
          total: items.length,
          offset,
          limit,
        },
      });
      return;
    }
    const selectedVersion = url.pathname.match(
      new RegExp(`^/api/rules/${ruleId}/versions/(\\d+)$`),
    );
    if (selectedVersion) {
      await route.fulfill({
        json: {
          ruleId,
          version: Number(selectedVersion[1]),
          definition,
          publishedAt,
        },
      });
      return;
    }
    if (
      url.pathname === `/api/rules/${ruleId}/execute` &&
      request.method() === "POST"
    ) {
      const execution = request.postDataJSON() as {
        version: number;
        inputs: Record<string, unknown>;
      };
      state.executions.push(execution);
      if (state.executionError) {
        await route.fulfill({
          status: 422,
          json: { message: "Amount is invalid for this rule" },
        });
      } else {
        await route.fulfill({
          json: {
            ruleId,
            version: execution.version,
            result: execution.inputs.amount,
            trace: [],
            durationMicros: 10,
          },
        });
      }
      return;
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({
      status: 404,
      json: { message: "Unexpected mocked API request" },
    });
  });
  return state;
}

async function executeVersion(page: Page, version: number) {
  await expect(
    page.getByRole("combobox", { name: "Version", exact: true }),
  ).toHaveText(`v${version}`);
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(page.getByTestId("api-response")).toContainText(
    `"version": ${version}`,
  );
}

test("fresh published catalog wins over a stale version in the parent library page", async ({
  page,
}) => {
  const state = await mockCatalog(page, true, 2);
  await page.goto("/#/playground");

  await executeVersion(page, 2);

  expect(state.executions).toHaveLength(1);
  expect(state.executions[0].version).toBe(2);
  expect(state.unexpected).toEqual([]);
});

test("refreshing an off-page selected rule advances its implicit published version", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 1);
  await page.goto("/#/playground");
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Version", exact: true }),
  ).toHaveText("v1");

  state.version = 2;
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("Catalog pricing");
  await executeVersion(page, 2);

  expect(state.executions[0].version).toBe(2);
  expect(state.unexpected).toEqual([]);
});

test("a chosen historical pin survives discovery of a newer published version", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 3);
  await page.goto("/#/playground");
  await expect(
    page.getByRole("combobox", { name: "Version", exact: true }),
  ).toHaveText("v3");
  await page.getByRole("combobox", { name: "Version", exact: true }).click();
  await page.getByRole("option", { name: "v1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  await setEditorText(
    page,
    page.getByLabel("API input JSON", { exact: true }),
    '{"amount":123}',
  );

  state.version = 4;
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("/version-summaries") && response.ok(),
  );
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("Catalog pricing");
  await refreshed;
  await executeVersion(page, 1);

  expect(state.executions[0]).toMatchObject({
    version: 1,
    inputs: { amount: 123 },
  });
  expect(state.unexpected).toEqual([]);
});

test("paging history retains the newest implicit version learned after stale catalog reads", async ({
  page,
}) => {
  const state = await mockCatalog(page, true, 1);
  state.historyVersion = 25;
  await page.goto("/#/playground");
  await expect(
    page.getByRole("combobox", { name: "Version", exact: true }),
  ).toHaveText("v25");
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  const inputs = page.getByLabel("API input JSON", { exact: true });
  await setEditorText(page, inputs, '{"amount":456}');

  const historyPages = page.getByRole("navigation", {
    name: "Published versions pages",
    exact: true,
  });
  await historyPages.getByRole("button", { name: "Next", exact: true }).click();
  await expect(historyPages).toContainText("21–25 of 25");
  await expect(
    page.getByRole("combobox", { name: "Version", exact: true }),
  ).toHaveText("v25");
  await expect(editorLines(inputs)).toHaveText('{"amount":456}');
  await executeVersion(page, 25);

  expect(state.executions[0]).toMatchObject({
    version: 25,
    inputs: { amount: 456 },
  });
  expect(state.unexpected).toEqual([]);
});

test("retrying metadata for the same rule and version preserves edited execution inputs", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 1);
  await page.goto("/#/playground");
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  const inputs = page.getByLabel("API input JSON", { exact: true });
  await setEditorText(page, inputs, '{"amount":987}');

  state.failCatalogOnce = true;
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("Catalog pricing");
  await expect(
    page.getByText("Catalog temporarily unavailable", { exact: true }),
  ).toBeVisible();
  const reloadedDetail = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rules/${ruleId}/versions/1`) &&
      response.ok(),
  );
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await reloadedDetail;
  await expect(
    page.getByRole("button", { name: "Retry loading", exact: true }),
  ).toHaveCount(0);
  await expect(editorLines(inputs)).toHaveText('{"amount":987}');
  await executeVersion(page, 1);

  expect(state.executions[0].inputs).toEqual({ amount: 987 });
  expect(state.unexpected).toEqual([]);
});

test("runtime errors keep edited inputs and offer execution rather than a metadata retry", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 1);
  state.executionError = true;
  await page.goto("/#/playground");
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  const inputs = page.getByLabel("API input JSON", { exact: true });
  await setEditorText(page, inputs, '{"amount":321}');
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(
    page.getByText("Amount is invalid for this rule", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry loading", exact: true }),
  ).toHaveCount(0);
  await expect(editorLines(inputs)).toHaveText('{"amount":321}');

  state.executionError = false;
  await executeVersion(page, 1);
  expect(state.executions).toHaveLength(2);
  expect(state.executions[1].inputs).toEqual({ amount: 321 });
  expect(state.unexpected).toEqual([]);
});
