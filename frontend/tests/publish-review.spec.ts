import { expect, test } from "@playwright/test";
import type { Page as VersionPage, VersionSummary } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRuleResponse,
  uniqueId,
} from "./helpers/api";
import { canvasNode } from "./helpers/canvas";

test("publishing reviews the changes since the latest version, keeps a note and refuses a repeat", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("review"),
    name: `Review ${uniqueId("name")}`,
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  // The first version has nothing to compare with.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Publish version 1" });
  await expect(dialog).toContainText("This is the rule's first version");
  await dialog.getByLabel("Release note (optional)").fill("First cut");
  await dialog.getByRole("button", { name: "Publish v1", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();

  // An unchanged draft would repeat v1, so Publish is not offered, and says why.
  const publish = page.getByRole("button", { name: "Publish", exact: true });
  await expect(publish).toBeDisabled();
  await page.locator(".editor-actions > span").filter({ has: publish }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Nothing to publish: the draft is version 1 as published.",
  );

  // A saved change marks the library card until it is published.
  await canvasNode(page, "out").click();
  await page.getByLabel("Node name", { exact: true }).fill("Total");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.goto("/#/library");
  await page.getByRole("textbox", { name: "Search rules" }).fill(rule.name);
  const card = page.locator(".rule-card").filter({ hasText: rule.name });
  await expect(card).toContainText("Unpublished changes");
  await expect(card).toContainText("Published · v1");

  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Publish version 2" });
  // Each changed node lists its properties before and after.
  await expect(dialog.locator(".version-changes > ul > li")).toHaveCount(1);
  await expect(dialog.locator(".version-changes > ul > li")).toContainText(
    "Changed: Total",
  );
  await expect(dialog.locator(".change-details > li")).toHaveText([
    "Name: Result → Total",
  ]);
  await dialog.getByLabel("Release note (optional)").fill("Names the total");
  await dialog.getByRole("button", { name: "Publish v2", exact: true }).click();
  await expect(
    page.getByText("Version 2 published and ready to call"),
  ).toBeVisible();

  // The history shows each version's note, and the API returns it.
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  const history = page.locator(".version-bar");
  await expect(history.getByRole("button", { name: /^v2/ })).toContainText(
    "Names the total",
  );
  await expect(history.getByRole("button", { name: /^v1/ })).toContainText(
    "First cut",
  );
  const versions = (await (
    await request.get(`/api/rules/${rule.id}/version-summaries`)
  ).json()) as VersionPage<VersionSummary>;
  expect(versions.items.map((version) => version.note)).toEqual([
    "Names the total",
    "First cut",
  ]);
  await page.goto("/#/library");
  await page.getByRole("textbox", { name: "Search rules" }).fill(rule.name);
  await expect(card).toContainText("Published · v2");
  await expect(card).not.toContainText("Unpublished changes");
});

test("a release note longer than the server keeps is refused in the dialog", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("review-note"),
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish version 1" });
  await dialog.getByLabel("Release note (optional)").fill("x".repeat(501));
  await expect(dialog).toContainText("A note holds at most 500 characters");
  await expect(
    dialog.getByRole("button", { name: "Publish v1", exact: true }),
  ).toBeDisabled();
  const refused = await publishRuleResponse(request, rule, "x".repeat(501));
  expect(refused.status()).toBe(422);
  expect((await refused.json()).message).toBe(
    "Release note exceeds 500 characters",
  );
});
