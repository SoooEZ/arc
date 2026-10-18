import { expect, test } from "@playwright/test";

test("with no published rule, the playground shows where a rule's ID goes instead of a sample rule", async ({
  page,
}) => {
  await page.route(/\/api\/rule-summaries\?/, (route) =>
    route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.goto("/#/playground");
  await expect(
    page.getByText(
      "Publish a rule in the library to make your first API call.",
    ),
  ).toBeVisible();
  await expect(page.locator(".endpoint code")).toHaveText(
    "/api/rules/{rule-id}/execute",
  );
  const curl = page.getByTestId("api-response");
  await expect(curl).toContainText("/api/rules/{rule-id}/execute");
  await expect(curl).not.toContainText("order-pricing");
  // No version is named until a rule's version is.
  await expect(curl).not.toContainText('"version"');
});
