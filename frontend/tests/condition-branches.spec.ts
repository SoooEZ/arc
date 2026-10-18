import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRule, readRule, uniqueId } from "./helpers/api";
import { canvasNode } from "./helpers/canvas";

async function chooseBranches(scope: Page | Locator, page: Page, mode: string) {
  await scope.getByRole("combobox", { name: "Branches", exact: true }).click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

/** The Condition rule template: Check amount, True to Eligible and False to Not eligible. */
async function conditionRule(
  page: Page,
  request: Parameters<typeof createRule>[0],
) {
  const rule = await createRule(request, {
    id: uniqueId("branches"),
    kind: "RULE",
  });
  await page.goto(`/#/rules/${rule.id}?node=condition`);
  const card = canvasNode(page, "condition");
  await expect(card.locator(".handle-caption")).toHaveText(["True", "False"]);
  return { rule, card };
}

const conditionEdges = async (
  request: Parameters<typeof readRule>[0],
  id: string,
) =>
  (await readRule(request, id)).draft.edges
    .filter((edge) => edge.source === "condition")
    .map((edge) => [edge.sourceHandle, edge.target]);

test("the Condition node turns into cases and back, and keeps its connections", async ({
  page,
  request,
}) => {
  const { rule, card } = await conditionRule(page, request);
  const captions = card.locator(".handle-caption");
  await expect(
    page.getByRole("menuitem", { name: "Switch", exact: true }),
  ).toHaveCount(0);

  await chooseBranches(page, page, "Cases · first true case");
  await expect(captions).toHaveText(["Case 1", "Default"]);
  await expect(card.locator(".node-type-line")).toContainText("Condition");
  await expect(
    page.getByLabel("Case 1 condition", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await readRule(request, rule.id);
  const cases = saved.draft.nodes.find((node) => node.id === "condition")!;
  expect(cases).toMatchObject({
    type: "SWITCH",
    selector: null,
    cases: [{ label: "Case 1", expression: "amount >= 100" }],
  });
  const caseHandle = `case:${cases.cases![0].id}`;
  expect(await conditionEdges(request, rule.id)).toEqual([
    [caseHandle, "yes"],
    ["default", "no"],
  ]);

  // More than one case cannot be True / False; one condition case can again.
  await page.getByRole("button", { name: "Add case", exact: true }).click();
  await expect(captions).toHaveText(["Case 1", "Case 2", "Default"]);
  await page.getByRole("combobox", { name: "Branches", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "True / False", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Remove case 2", exact: true })
    .click();
  await chooseBranches(page, page, "True / False");
  await expect(captions).toHaveText(["True", "False"]);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(
    (await readRule(request, rule.id)).draft.nodes.find(
      (node) => node.id === "condition",
    ),
  ).toMatchObject({ type: "CONDITION", expression: "amount >= 100" });
  expect(await conditionEdges(request, rule.id)).toEqual([
    ["true", "yes"],
    ["false", "no"],
  ]);
});

test("Add case on a True / False Condition, and Branches in the node dialog, convert it with its connections", async ({
  page,
  request,
}) => {
  const { rule, card } = await conditionRule(page, request);
  const captions = card.locator(".handle-caption");
  await page.getByRole("button", { name: "Add case", exact: true }).click();
  await expect(captions).toHaveText(["Case 1", "Case 2", "Default"]);
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  // Case 2 has no connection yet; Case 1 and Default kept theirs.
  await expect(page.getByText(/connect the Case 2 exit/).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Remove case 2", exact: true })
    .click();
  await chooseBranches(page, page, "True / False");
  await expect(captions).toHaveText(["True", "False"]);

  // The staged node dialog applies the conversion with its connections.
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseBranches(dialog, page, "Match a value");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(captions).toHaveText(["Case 1", "Default"]);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const node = (await readRule(request, rule.id)).draft.nodes.find(
    (item) => item.id === "condition",
  )!;
  expect(node).toMatchObject({
    type: "SWITCH",
    selector: "amount >= 100",
    cases: [{ label: "Case 1", expression: "true" }],
  });
  expect(await conditionEdges(request, rule.id)).toEqual([
    [`case:${node.cases![0].id}`, "yes"],
    ["default", "no"],
  ]);
});
