import { expect, test } from "@playwright/test";
import { createRule, inputToOutput, uniqueId } from "./helpers/api";

test("a node's problems read as sentences on its card, in the inspector and beside a refused test run", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("problems"),
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Condition" }).click();
  const condition = page
    .locator(".react-flow__node")
    .filter({ hasText: "Condition" })
    .last();

  // A new Condition opens in the comparison builder, not on a bare `true`.
  await expect(page.getByLabel("When", { exact: true })).toBeVisible();
  await expect(page.locator(".expression-preview")).toContainText(
    "Until you choose what to compare, the condition is always true.",
  );

  // The card names its first problem in place of its kind and counts them all.
  await expect(condition.locator(".node-type-problem")).toHaveText(
    "Connect the True and False exits",
  );
  await expect(condition.locator(".node-error-message")).toHaveText("2 errors");
  // The inspector keeps the first problem in its footer.
  const footer = page.locator(".inspector-footer-problem");
  await expect(footer).toContainText("Connect the True and False exits");
  await expect(footer).toContainText("+1 more");

  // A refused run names its first problem and lists the graph's others.
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  const failure = page.locator(".test-output .MuiAlert-root");
  await expect(failure).toContainText(
    "Condition: connect the True and False exits",
  );
  await expect(failure).toContainText("1 more problem in this graph");
  await expect(failure).toContainText(
    "Condition: not reachable from Input; connect it or remove it",
  );
  await failure
    .getByRole("button", { name: "Show Condition", exact: true })
    .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Condition",
  );

  // Validate stops at the first problem and counts the others on the canvas.
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.locator(".editor > .MuiAlert-root")).toContainText(
    "1 more problem is marked on the canvas.",
  );
});
