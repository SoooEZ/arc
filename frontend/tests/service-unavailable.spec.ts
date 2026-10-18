import { expect, test } from "@playwright/test";

// The library's catalog request; a stopped API answers it through the proxy.
const catalog = /\/api\/rule-summaries\?/;

test("an unanswered request says the service is not responding, and Retry recovers", async ({
  page,
}) => {
  // What nginx and the Vite proxy return while the API container is down.
  await page.route(catalog, (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html><body><h1>502 Bad Gateway</h1></body></html>",
    }),
  );
  await page.goto("/#/library");
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "The ARC service is not responding (502)." });
  await expect(failure).toContainText(
    "It may be restarting; try again in a moment.",
  );
  await page.unroute(catalog);
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByText(/^\d+ rules?$/)).toBeVisible();
});

test("a request that reaches no server says so", async ({ page }) => {
  await page.route(catalog, (route) => route.abort("connectionrefused"));
  await page.goto("/#/library");
  await expect(page.getByRole("alert")).toContainText(
    "Could not reach the ARC service. Check the connection and try again.",
  );
});
