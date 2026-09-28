import { expect, test, type Page } from "@playwright/test";
import type { Definition, RuleSummary } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const ruleId = "catalog-pricing";
const publishedAt = "2026-09-25T12:00:00Z";

function summary(
  id: string,
  version: number,
  createdAt = publishedAt,
): RuleSummary {
  return {
    id,
    name: id === ruleId ? "Catalog pricing" : `Other rule ${id}`,
    description: "",
    kind: "FORMULA",
    revision: version,
    publishedVersion: version,
    createdAt,
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
    /** When the rule was created; another value means it was deleted and created again. */
    createdAt: publishedAt,
    /** The rule is gone: it leaves the catalog and its versions answer 404. */
    deleted: false,
    historyVersion: null as number | null,
    failCatalogOnce: false,
    executionError: false,
    executions: [] as { version: number; inputs: Record<string, unknown> }[],
    /** Raw request bodies, which keep number tokens that postDataJSON would round. */
    executionBodies: [] as string[],
    historyRequests: [] as number[],
    /** Raw JSON texts, so a mocked number keeps digits that a double cannot. */
    rawDefinition: null as string | null,
    rawResult: null as string | null,
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
      const published = state.deleted
        ? []
        : [summary(ruleId, state.version, state.createdAt)];
      await route.fulfill({
        json: {
          items: publishedOnly ? published : parentRules,
          total: publishedOnly ? published.length : 40,
          offset,
          limit,
        },
      });
      return;
    }
    if (url.pathname === `/api/rules/${ruleId}/version-summaries`) {
      state.historyRequests.push(offset);
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
      if (state.deleted) {
        await route.fulfill({
          status: 404,
          json: { message: `Rule not found: ${ruleId}` },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: `{"ruleId":"${ruleId}","version":${Number(selectedVersion[1])},"publishedAt":"${publishedAt}","definition":${state.rawDefinition ?? JSON.stringify(definition)}}`,
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
      state.executionBodies.push(request.postData() ?? "");
      if (state.deleted) {
        await route.fulfill({
          status: 404,
          json: { message: `Rule not found: ${ruleId}` },
        });
      } else if (state.executionError) {
        await route.fulfill({
          status: 422,
          json: { message: "Amount is invalid for this rule" },
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          body: `{"ruleId":"${ruleId}","version":${execution.version},"result":${state.rawResult ?? JSON.stringify(execution.inputs.amount ?? null)},"trace":[],"durationMicros":10}`,
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

test("a rule created again under the same ID replaces the selection and its remembered releases", async ({
  page,
}) => {
  const state = await mockCatalog(page, true, 2);
  await page.goto("/#/playground");
  await executeVersion(page, 2);

  // Deleted and created again elsewhere: the new rule has one version, and the
  // parent library page still lists the old one at v2.
  state.version = 1;
  state.createdAt = "2026-09-28T09:00:00Z";
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("Catalog pricing");
  await executeVersion(page, 1);

  expect(state.executions.map((execution) => execution.version)).toEqual([
    2, 1,
  ]);
  expect(state.unexpected).toEqual([]);
});

test("a deleted rule leaves the playground instead of a version that can never load", async ({
  page,
}) => {
  const state = await mockCatalog(page, true, 2);
  await page.goto("/#/playground");
  await executeVersion(page, 2);

  state.deleted = true;
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(
    page.getByText(
      "Publish a rule in the library to make your first API call.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: /not found/ }),
  ).toHaveCount(0);
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
  // Learning v25 from the history page must not request that page again.
  expect(state.historyRequests).toEqual([0]);
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

test("the cURL preview sends only JSON-object inputs to the encoded execute URL", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 1);
  await page.goto("/#/playground");
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  const origin = new URL(page.url()).origin;
  const curl = page.getByTestId("api-response");
  await expect(curl).toContainText(
    `curl -X POST '${origin}/api/rules/${ruleId}/execute'`,
  );
  await expect(curl).toContainText('"amount": 10');
  const inputs = page.getByLabel("API input JSON", { exact: true });
  for (const invalid of ["null", "5", "[1, 2]", '"text"', '{"amount":']) {
    await setEditorText(page, inputs, invalid);
    await expect(editorLines(inputs)).toHaveText(invalid);
    await expect(
      page.getByText("Input parameters must be a JSON object.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(curl).toContainText('"inputs": {}');
    await expect(curl).not.toContainText('"amount"');
  }
  await setEditorText(page, inputs, '{"amount":7}');
  await expect(curl).toContainText('"amount": 7');
  await expect(
    page.getByText("Input parameters must be a JSON object.", {
      exact: false,
    }),
  ).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test("a JSON editor chunk that fails to load keeps the playground usable", async ({
  page,
}) => {
  const state = await mockCatalog(page, false, 1);
  await page.route("**/assets/InputJsonEditor-*.js", (route) => route.abort());
  await page.goto("/#/playground");
  await expect(
    page.getByText("Could not load the JSON editor.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "API playground", exact: true }),
  ).toBeVisible();
  // The sample inputs remain executable without the editor.
  await executeVersion(page, 1);
  expect(state.executions[0].inputs).toEqual({ amount: 10 });
  expect(state.unexpected).toEqual([]);
});

test("exact decimals survive the sample buffer, cURL and response without JSON.rawJSON", async ({
  page,
}) => {
  // Engines without JSON.rawJSON stringify a DecimalNumber as a string.
  await page.addInitScript(() => {
    Reflect.deleteProperty(JSON, "rawJSON");
  });
  const state = await mockCatalog(page, false, 1);
  state.rawDefinition = JSON.stringify(definition).replace(
    '"defaultValue":10',
    '"defaultValue":9007199254740993',
  );
  state.rawResult = "0.3333333333333333333333333333333333";
  await page.goto("/#/playground");
  const inputs = page.getByLabel("API input JSON", { exact: true });
  await expect(editorLines(inputs)).toContainText('"amount": 9007199254740993');
  const response = page.getByTestId("api-response");
  await expect(response).toContainText('"amount": 9007199254740993');
  await executeVersion(page, 1);
  expect(state.executionBodies[0]).toContain('"amount":9007199254740993');
  await expect(response).toContainText(
    '"result": 0.3333333333333333333333333333333333',
  );
  expect(state.unexpected).toEqual([]);
});
