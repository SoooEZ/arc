import { expect, test } from "@playwright/test";

test("an empty library offers to create a rule from a template or an imported graph", async ({
  page,
}) => {
  await page.route(/\/api\/rule-summaries\?/, (route) =>
    route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.goto("/#/library");
  const empty = page.locator(".empty-library");
  await expect(empty).toContainText("Build your first rule");
  await expect(empty).toContainText(
    "Start from a formula, condition or decision tree template, or import a graph file exported from ARC.",
  );
  // The empty state says it; no "0 results" pager repeats it.
  await expect(
    page.getByRole("navigation", { name: "Library rules pages" }),
  ).toHaveCount(0);
  await empty.getByRole("button", { name: "Create rule", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Graph file" }),
  ).toBeVisible();
});
