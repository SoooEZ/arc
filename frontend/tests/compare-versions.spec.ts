import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRule,
  readRule,
  uniqueId,
} from "./helpers/api";

const doubled: Definition = {
  ...inputToOutput,
  nodes: inputToOutput.nodes.map((node) =>
    node.id === "out"
      ? { ...node, label: "Doubled", expression: "amount * 2" }
      : node,
  ),
};

test("any two versions, or a version and the draft, compare property by property", async ({
  page,
  request,
}) => {
  let rule: Rule = await createRule(request, {
    id: uniqueId("compare"),
    definition: inputToOutput,
  });
  rule = await publishRule(request, rule);
  const saved = await request.put(`/api/rules/${rule.id}`, {
    data: {
      name: rule.name,
      description: rule.description,
      revision: rule.revision,
      definition: doubled,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  rule = await publishRule(request, await readRule(request, rule.id));

  // A version compares with the one before it: what it changed.
  await page.goto(`/#/rules/${rule.id}?version=2`);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare versions" });
  await expect(dialog.getByLabel("From")).toHaveText("v1");
  await expect(dialog.getByLabel("To")).toHaveText("v2");
  await expect(dialog.locator(".version-changes")).toContainText(
    "Changes from v1 to v2",
  );
  await expect(dialog.locator(".version-changes > ul > li")).toHaveCount(1);
  const details = dialog.locator(".change-details > li");
  await expect(details).toHaveText([
    "Name: Result → Doubled",
    "Returns: amount → amount * 2",
  ]);

  // The saved draft is v2 as published.
  await dialog.getByLabel("From").click();
  await page.getByRole("option", { name: "Draft", exact: true }).click();
  await expect(dialog).toContainText("Nothing changed from the draft to v2.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // From the history, the latest version compares with the draft, unsaved edits included.
  await page.goto(`/#/rules/${rule.id}`);
  await page.locator('.react-flow__node[data-id="out"]').click();
  await page.getByLabel("Node name", { exact: true }).fill("Twice");
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await page
    .locator(".version-bar")
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await expect(dialog.getByLabel("From")).toHaveText("v2");
  await expect(dialog.getByLabel("To")).toHaveText("Draft");
  await expect(details).toHaveText(["Name: Doubled → Twice"]);
});
