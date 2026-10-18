import { expect, test } from "@playwright/test";
import type { DataSource } from "../src/types";
import { createSource, uniqueId } from "./helpers/api";
import { lookupEntriesJson } from "./helpers/sources";

test("lookup entries edit as a table whose cells, rows, columns and keys write the JSON", async ({
  page,
  request,
}) => {
  const source = await createSource(request, {
    id: uniqueId("lookup-table"),
    name: `Lookup table ${uniqueId("name")}`,
    definition: {
      kind: "LOOKUP",
      parameters: [
        { name: "key", type: "STRING", required: true, defaultValue: null },
      ],
      entries: { DE: { rate: 0.19, currency: "EUR" } },
      timeoutMs: 3000,
    },
  });
  await page.goto("/#/sources");
  await page.getByLabel("Search data sources").fill(source.name);
  await page
    .locator(".source-list > button")
    .filter({ hasText: source.name })
    .click();
  const view = page.getByRole("group", { name: "Lookup entries view" });
  await expect(
    view.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("columnheader")).toContainText([
    "Key",
    "rate",
    "currency",
  ]);

  await page.getByLabel("DE · rate", { exact: true }).fill("0.210");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  const key = page.getByLabel("Key key", { exact: true });
  await key.fill("DE");
  await key.press("Enter");
  // A taken key stays in its field with the problem and changes nothing.
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await key.fill("FR");
  await key.press("Enter");
  await page.getByLabel("FR · rate", { exact: true }).fill("0.2");
  await page.getByLabel("FR · currency", { exact: true }).fill("EUR");
  await page.getByLabel("New column", { exact: true }).fill("note");
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.getByLabel("DE · note", { exact: true }).fill("standard");
  await expect(page.getByText("2 entries")).toBeVisible();

  // The JSON view shows the same entries, every digit as typed.
  const json = await lookupEntriesJson(page);
  await expect(json).toHaveValue(/"rate": 0\.210/);
  await expect(json).toHaveValue(/"note": "standard"/);
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByRole("button", { name: "Save new version" }),
  ).toBeDisabled();
  const saved = (await (
    await request.get(`/api/sources/${source.id}/versions/2`)
  ).json()) as DataSource;
  const entries = saved.definition.entries as Record<string, unknown>;
  // The database orders a record's keys its own way, so compare values.
  expect(entries).toEqual({
    DE: { rate: 0.21, currency: "EUR", note: "standard" },
    FR: { rate: 0.2, currency: "EUR" },
  });
});
