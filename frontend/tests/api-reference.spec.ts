import { expect, test } from "@playwright/test";

test("the API reference links to the playground instead of repeating its request console", async ({
  page,
}) => {
  await page.goto("/#/docs");
  await expect(
    page.getByRole("heading", { name: "Your logic, on demand." }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Rule", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open the API playground", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/playground$/);
  await expect(
    page.getByRole("combobox", { name: "Rule", exact: true }),
  ).toBeVisible();
});
