import { expect, test, type Page } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

// An intercepting proxy or captive portal can answer with 200 and an HTML page.
const proxyPage = {
  status: 200,
  contentType: "text/html",
  body: "<!doctype html><title>Network sign-in</title>",
};
const unreadable =
  "The server response could not be read (200). Check your connection and try again.";

function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("a save answered by an unreadable 200 response reports an error and keeps the draft", async ({
  page,
  request,
}) => {
  const id = uniqueId("unreadable-save");
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "1",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "out", sourceHandle: "next" },
    ],
  };
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  const errors = pageErrors(page);
  await page.goto(`/#/rules/${id}?node=out`);
  const name = page.getByLabel("Node name", { exact: true });
  await name.fill("Renamed result");
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await page.route(`**/api/rules/${id}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill(proxyPage)
      : route.continue(),
  );
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: unreadable }),
  ).toBeVisible();
  await expect(name).toHaveValue("Renamed result");
  await expect(save).toBeEnabled();
  expect(errors).toEqual([]);

  await page.unroute(`**/api/rules/${id}`);
  await save.click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "out")?.label).toBe(
    "Renamed result",
  );
});

test("a library page answered by an unreadable 200 response offers a retry", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.route("**/api/rule-summaries?*", (route) =>
    route.fulfill(proxyPage),
  );
  await page.goto("/#/library");
  const alert = page.getByRole("alert").filter({ hasText: unreadable });
  await expect(alert).toBeVisible();
  expect(errors).toEqual([]);

  await page.unroute("**/api/rule-summaries?*");
  await alert.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator(".rule-grid")).toBeVisible();
});
