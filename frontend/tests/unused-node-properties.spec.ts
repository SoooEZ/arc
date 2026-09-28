import { expect, test } from "@playwright/test";
import type { Rule } from "../src/types";

test("a node that sets a property its kind does not use is named and removed by hand", async ({
  page,
  request,
}) => {
  const id = `unused-properties-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: "Unused properties", kind: "FORMULA" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  // The server now refuses to store such a node, but drafts and versions
  // stored before it enforced property ownership may still hold one.
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rule = (await response.json()) as Rule;
    const nodes = rule.draft.nodes.map((node) =>
      node.id === "calculate" ? { ...node, bindings: { amount: "1" } } : node,
    );
    await route.fulfill({
      response,
      json: { ...rule, draft: { ...rule.draft, nodes } },
    });
  });

  await page.goto(`/#/rules/${id}`);
  await page.locator('.react-flow__node[data-id="calculate"]').click();
  const notice = page.locator(".inspector-unused-properties");
  await expect(notice).toContainText(
    "This Formula node also sets parameter bindings, which Formula nodes do not use.",
  );
  // The server's diagnostics report the same node.
  await expect(
    page.getByRole("button", { name: "Node errors (1)", exact: true }),
  ).toBeVisible();

  await notice.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Node errors/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();

  await page.unroute(`**/api/rules/${id}`);
  const saved = (await (await request.get(`/api/rules/${id}`)).json()) as Rule;
  const calculate = saved.draft.nodes.find((node) => node.id === "calculate");
  expect(calculate?.bindings ?? null).toBeNull();
  expect((await request.delete(`/api/rules/${id}`)).status()).toBe(204);
});
