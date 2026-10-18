import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shows a section of the source form in `view`. Sections open as a table or a
 * form, and the page keeps the view chosen last for each of them. A click is
 * repeated until the view is chosen: a sample fetched just before can still
 * move the section, and a click that lands beside the button changes nothing.
 */
async function showView(scope: Page | Locator, group: string, view: string) {
  const button = scope
    .getByRole("group", { name: group })
    .getByRole("button", { name: view, exact: true });
  await expect(async () => {
    if ((await button.getAttribute("aria-pressed")) !== "true")
      await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true", {
      timeout: 1000,
    });
  }).toPass();
}

/** The lookup entries' JSON textarea, switched to first. */
export async function lookupEntriesJson(
  scope: Page | Locator,
): Promise<Locator> {
  await showView(scope, "Lookup entries view", "JSON");
  return scope.getByLabel("Lookup entries · JSON object", { exact: true });
}

/** The source parameters' JSON textarea, switched to first. */
export async function sourceParametersJson(
  scope: Page | Locator,
): Promise<Locator> {
  await showView(scope, "Source parameters view", "JSON");
  return scope.getByLabel("Source parameters · JSON", { exact: true });
}

/** The test parameters' JSON textarea, switched to first. */
export async function testParametersJson(
  scope: Page | Locator,
): Promise<Locator> {
  await showView(scope, "Test parameters view", "JSON");
  return scope.getByLabel("Test parameters · JSON", { exact: true });
}

/** The secret header aliases' JSON textarea, switched to first. */
export async function secretHeadersJson(
  scope: Page | Locator,
): Promise<Locator> {
  await showView(scope, "Secret headers view", "JSON");
  return scope.getByLabel("Secret header aliases · JSON", { exact: true });
}
