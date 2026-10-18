import { expect, test } from "@playwright/test";

test("Getting started explains the authoring path and its shortcuts, and leads on to the API", async ({
  page,
}) => {
  await page.goto("/#/library");
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Getting started" }).click();
  const help = page.getByRole("dialog", { name: "Getting started" });
  await expect(help.getByRole("listitem")).toHaveText([
    /^Create a rule/,
    /^Add inputs and steps/,
    /^Test as you build/,
    /^Publish a version/,
    /^Call it from your application/,
  ]);
  const shortcuts = help.getByRole("table", { name: "Keyboard shortcuts" });
  await expect(shortcuts.getByRole("row")).toHaveCount(6);
  await expect(
    shortcuts.getByRole("row", { name: /Save the draft/ }).locator("kbd"),
  ).toHaveText(["⌘/Ctrl", "S"]);
  await expect(
    shortcuts.getByRole("row", { name: /Remove the selected/ }).locator("kbd"),
  ).toHaveText(["Delete", "Backspace"]);
  // The help no longer replaces the page: the library stays underneath.
  await expect(page).toHaveURL(/#\/library$/);

  await help.getByRole("button", { name: "API reference" }).click();
  await expect(help).toHaveCount(0);
  await expect(page).toHaveURL(/#\/docs$/);

  await page.getByRole("button", { name: "Getting started" }).click();
  await page
    .getByRole("dialog", { name: "Getting started" })
    .getByRole("button", { name: "Create a rule" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Create a rule" }),
  ).toBeVisible();
});

test("? opens the help unless the focus is in a field", async ({ page }) => {
  await page.goto("/#/library");
  const search = page.getByLabel("Search rules", { exact: true });
  await search.click();
  await page.keyboard.type("?");
  await expect(search).toHaveValue("?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await search.fill("");
  await page.getByRole("heading", { name: "Rule library" }).click();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Getting started" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("the help fits a phone and the sidebar closes behind it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/library");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Getting started" }).click();
  await expect(
    page.getByRole("dialog", { name: "Getting started" }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveClass(/is-compact/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});
