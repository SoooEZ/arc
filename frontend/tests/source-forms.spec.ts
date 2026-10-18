import { expect, test, type Page } from "@playwright/test";
import type { DataSource } from "../src/types";
import { createSource, uniqueId } from "./helpers/api";
import {
  secretHeadersJson,
  sourceParametersJson,
  testParametersJson,
} from "./helpers/sources";

async function openSource(page: Page, name: string) {
  await page.goto("/#/sources");
  await page.getByLabel("Search data sources").fill(name);
  await page.locator(".source-list > button").filter({ hasText: name }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("an HTTP source's parameters edit as a table that writes the parameters JSON", async ({
  page,
  request,
}) => {
  const source = await createSource(request, {
    id: uniqueId("parameter-table"),
    name: `Parameter table ${uniqueId("name")}`,
    definition: {
      kind: "HTTP",
      url: "https://example.com/customer",
      parameters: [
        {
          name: "customerId",
          type: "STRING",
          required: true,
          defaultValue: null,
        },
      ],
      secretHeaders: {},
      timeoutMs: 3000,
    },
  });
  await openSource(page, source.name);
  await expect(
    page
      .getByRole("group", { name: "Source parameters view" })
      .getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Parameter 1 · name", { exact: true }),
  ).toHaveValue("customerId");
  const save = page.getByRole("button", { name: "Save new version" });

  await page
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  const name = page.getByLabel("Parameter 2 · name", { exact: true });
  await expect(name).toHaveValue("parameter");
  // A name another parameter has is marked, and Save waits with the reason.
  await name.fill("customerId");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Parameter 2: another parameter is named customerId"),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  // A character no name may have is refused where it is typed.
  await name.fill("limit");
  await name.press("$");
  await expect(name).toHaveValue("limit");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.press("s");
  await expect(name).toHaveValue("limits");
  await expect(name).toHaveAttribute("aria-invalid", "false");

  await page
    .getByLabel("Parameter 2 · type", { exact: true })
    .selectOption("NUMBER");
  await page.getByLabel("Parameter 2 · required", { exact: true }).uncheck();
  const fallback = page.getByLabel("Parameter 2 · default", { exact: true });
  // Text that is not a number stays in its cell and keeps Save disabled.
  await fallback.fill("12a");
  await expect(fallback).toHaveAttribute("aria-invalid", "true");
  await expect(save).toBeDisabled();
  await fallback.fill("25.50");
  await expect(fallback).toHaveAttribute("aria-invalid", "false");
  await expect(save).toBeEnabled();

  await page
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove parameter 3 (parameter)" })
    .click();
  await expect(page.getByText("2 parameters", { exact: true })).toBeVisible();

  // The JSON view shows the same list, every digit as typed.
  const json = await sourceParametersJson(page);
  await expect(json).toHaveValue(/"name": "limits"/);
  await expect(json).toHaveValue(/"defaultValue": 25\.50/);
  await save.click();
  await expect(save).toBeDisabled();
  const saved = (await (
    await request.get(`/api/sources/${source.id}/versions/2`)
  ).json()) as DataSource;
  expect(saved.definition.parameters).toEqual([
    {
      name: "customerId",
      type: "STRING",
      required: true,
      defaultValue: null,
      source: null,
    },
    {
      name: "limits",
      type: "NUMBER",
      required: false,
      defaultValue: 25.5,
      source: null,
    },
  ]);

  // A test parameter whose text is not a number holds the fetch.
  const limits = page.getByRole("textbox", { name: "limits", exact: true });
  await expect(limits).toHaveValue("25.50");
  await limits.fill("abc");
  const fetchSample = page.getByRole("button", { name: "Fetch sample" });
  await expect(fetchSample).toBeDisabled();
  await expect(
    page.getByText("Fix the marked test parameters before fetching a sample."),
  ).toBeVisible();
  await limits.fill("30");
  await expect(fetchSample).toBeEnabled();
});

test("secret headers edit as a table that checks what the server checks", async ({
  page,
  request,
}) => {
  const source = await createSource(request, {
    id: uniqueId("secret-headers"),
    name: `Secret headers ${uniqueId("name")}`,
    definition: {
      kind: "HTTP",
      url: "https://example.com/customer",
      parameters: [
        {
          name: "customerId",
          type: "STRING",
          required: true,
          defaultValue: null,
        },
      ],
      secretHeaders: {},
      timeoutMs: 3000,
    },
  });
  await openSource(page, source.name);
  await expect(page.getByText("No secret headers are sent.")).toBeVisible();
  const save = page.getByRole("button", { name: "Save new version" });
  await page.getByRole("button", { name: "Add header", exact: true }).click();
  // A header without an alias is not sendable yet, and Save says so.
  const alias = page.getByLabel("Authorization · alias", { exact: true });
  await expect(alias).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText(
      "Secret headers map header names to uppercase environment aliases",
    ),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  // An alias names an environment variable, so it is typed in upper case.
  await alias.fill("crm_token");
  await expect(alias).toHaveValue("CRM_TOKEN");
  await expect(alias).toHaveAttribute("aria-invalid", "false");
  await expect(save).toBeEnabled();
  // A header the server never sends as a secret stays in its cell, marked.
  const header = page.getByLabel("Header Authorization", { exact: true });
  await header.fill("Host");
  await header.press("Enter");
  await expect(header).toHaveAttribute("aria-invalid", "true");
  await header.fill("X-Api-Key");
  await header.press("Enter");
  await expect(
    page.getByLabel("X-Api-Key · alias", { exact: true }),
  ).toHaveValue("CRM_TOKEN");
  await expect(await secretHeadersJson(page)).toHaveValue(
    JSON.stringify({ "X-Api-Key": "CRM_TOKEN" }, null, 2),
  );
});

test("a lookup source shows its one key parameter, and tests take a form that writes the test JSON", async ({
  page,
  request,
}) => {
  const source = await createSource(request, {
    id: uniqueId("lookup-key"),
    name: `Lookup key ${uniqueId("name")}`,
    definition: {
      kind: "LOOKUP",
      parameters: [
        { name: "key", type: "STRING", required: true, defaultValue: null },
      ],
      entries: { DE: { rate: 0.19 }, US: { rate: 0.07 } },
      timeoutMs: 3000,
    },
  });
  await openSource(page, source.name);
  // The key keeps its name: only its type, flag and default can change.
  await expect(page.getByLabel("Key · type", { exact: true })).toHaveValue(
    "STRING",
  );
  await expect(page.getByLabel("Parameter 1 · name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add parameter" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("A rule reads one row of the table by its key."),
  ).toBeVisible();

  await expect(
    page
      .getByRole("group", { name: "Test parameters view" })
      .getByRole("button", { name: "Form", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const key = page.getByRole("textbox", { name: "key", exact: true });
  await expect(key).toHaveValue("US");
  await key.fill("DE");
  await page.getByRole("button", { name: "Fetch sample", exact: true }).click();
  await expect(page.getByTestId("source-result")).toContainText('"rate": 0.19');
  const json = await testParametersJson(page);
  await expect(json).toHaveValue(JSON.stringify({ key: "DE" }, null, 2));

  // A key type change reaches the parameters JSON.
  await page.getByLabel("Key · type", { exact: true }).selectOption("NUMBER");
  await expect(await sourceParametersJson(page)).toHaveValue(
    /"type": "NUMBER"/,
  );
});

test("a new source shows a field's problem only once the field is edited or left", async ({
  page,
}) => {
  await page.goto("/#/sources");
  await page.getByRole("button", { name: "New source", exact: true }).click();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("button", { name: "Create source", exact: true }),
  ).toBeDisabled();
  // The disabled button says why.
  await page.locator(".source-save").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Enter a valid source ID",
  );
  await name.fill("Draft");
  await name.fill("");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Source name must contain 1 to 160 characters"),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Provider", exact: true }).click();
  await page
    .getByRole("option", { name: "HTTP GET · JSON response", exact: true })
    .click();
  const url = page.getByLabel("HTTP URL", { exact: true });
  await expect(url).toHaveAttribute("aria-invalid", "false");
  await url.fill("ftp://example.com/data");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  // Nothing is stored to call yet.
  await expect(page.getByText("Create the source to test it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fetch sample" })).toHaveCount(
    0,
  );
});

test("on a phone the source cards scroll sideways under a full-width search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/sources");
  const search = page.getByLabel("Search data sources");
  await expect(page.locator(".source-list > button").first()).toBeVisible();
  // The search field used to share one scrolling row with the cards and the pager.
  expect((await search.boundingBox())!.width).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});
