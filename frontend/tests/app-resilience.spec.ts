import { expect, test, type Page } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 200, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

/** Whether a page unload would still ask the user (the workspace guard is alive). */
function unloadIsGuarded(page: Page) {
  return page.evaluate(() => {
    const probe = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(probe);
    return probe.defaultPrevented;
  });
}

async function servedByViteDevServer(page: Page) {
  const html = await (await page.request.get("/")).text();
  return html.includes("/@vite/client");
}

test("a data source manager chunk that fails to load keeps the editor and its draft", async ({
  page,
  request,
}) => {
  test.skip(
    await servedByViteDevServer(page),
    "The dev server does not split chunks.",
  );
  const id = uniqueId("lazy-manager");
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  const chunkRequests: string[] = [];
  await page.route(/\/assets\/SourceManagerDialog-[^/]*\.js$/, (route) => {
    chunkRequests.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  await page.goto(`/#/rules/${id}?node=input`);
  const nodeName = page.getByLabel("Node name", { exact: true });
  await nodeName.fill("Inputs edited");

  const manage = page
    .locator(".input-schema-card")
    .first()
    .getByRole("button", { name: "Manage data sources", exact: true });
  await manage.click();
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "Could not load the data source manager" });
  await expect(failure).toBeVisible();
  expect(chunkRequests).toHaveLength(1);
  // Vite reports the failed chunk; the workspace asks to save and reload.
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Part of ARC could not be downloaded" }),
  ).toBeVisible();
  await expect(nodeName).toHaveValue("Inputs edited");
  expect(await unloadIsGuarded(page)).toBe(true);

  // The failure replaced the dialog, so it offers the dialog's Close.
  await failure.getByRole("button", { name: "Close", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Manage data sources" }),
  ).toHaveCount(0);
  await expect(manage).toBeVisible();
  await expect(nodeName).toHaveValue("Inputs edited");
  await nodeName.fill("Inputs edited twice");
  await expect(nodeName).toHaveValue("Inputs edited twice");
  expect(
    await page.evaluate(
      () => document.getElementById("root")!.childElementCount,
    ),
  ).toBeGreaterThan(0);
});

test("a rule editor chunk that fails to load leaves the workspace usable", async ({
  page,
  request,
}) => {
  test.skip(
    await servedByViteDevServer(page),
    "The dev server does not split chunks.",
  );
  const id = uniqueId("lazy-editor");
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  await page.route(/\/assets\/EditorRoute-[^/]*\.js$/, (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto(`/#/rules/${id}`);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load the rule editor" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Part of ARC could not be downloaded" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Data sources", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Data sources/ }),
  ).toBeVisible();
});

test("a page that throws while rendering shows a recoverable error and navigation still works", async ({
  page,
}) => {
  // A rule kind this client does not know, e.g. from a newer server.
  const unknownKind = {
    id: "unknown-kind",
    name: "Unknown kind",
    description: "",
    kind: "SPREADSHEET",
    revision: 1,
    publishedVersion: null,
    createdAt: "2026-09-27T00:00:00Z",
    updatedAt: "2026-09-27T00:00:00Z",
    nodeCount: 0,
    inputCount: 0,
    referenceCount: 0,
  };
  await page.route("**/api/rule-summaries?*", (route) =>
    route.fulfill({
      json: { items: [unknownKind], total: 1, offset: 0, limit: 20 },
    }),
  );
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  await page.goto("/#/library");
  const fallback = page
    .getByRole("alert")
    .filter({ hasText: "This page stopped working" });
  await expect(fallback).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Data sources", exact: true })
    .click();
  await expect(fallback).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Data sources/ }),
  ).toBeVisible();
  expect(uncaught).toEqual([]);
});
