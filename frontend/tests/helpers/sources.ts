import type { Locator, Page } from "@playwright/test";

/**
 * The lookup entries' JSON textarea, switched to first: the entries open as a
 * table, and the page keeps the view chosen last.
 */
export async function lookupEntriesJson(
  scope: Page | Locator,
): Promise<Locator> {
  const json = scope
    .getByRole("group", { name: "Lookup entries view" })
    .getByRole("button", { name: "JSON", exact: true });
  if ((await json.getAttribute("aria-pressed")) !== "true") await json.click();
  return scope.getByLabel("Lookup entries · JSON object", { exact: true });
}
