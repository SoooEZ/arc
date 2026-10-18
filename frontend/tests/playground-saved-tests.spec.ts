import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Rule } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRule,
  uniqueId,
} from "./helpers/api";

/** Saves a test case written as JSON text, so its numbers keep their decimal places. */
async function saveTestCase(
  request: APIRequestContext,
  rule: Rule,
  json: string,
) {
  const response = await request.post(`/api/rules/${rule.id}/test-cases`, {
    headers: { "Content-Type": "application/json" },
    data: json,
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function selectRule(page: Page, rule: Rule) {
  await page.goto("/#/playground");
  await page.getByLabel("Find published rules", { exact: true }).fill(rule.id);
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page.getByRole("option", { name: rule.name, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
}

async function loadSavedTest(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Load saved test", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "Saved tests" })
    .getByRole("menuitem", { name: new RegExp(`^${name}`) })
    .click();
}

test("a saved test fills the playground's inputs and says whether the version meets it", async ({
  page,
  request,
}) => {
  const rule = await publishRule(
    request,
    await createRule(request, {
      id: uniqueId("playground-tests"),
      name: `Playground tests ${uniqueId("p")}`,
      definition: inputToOutput,
    }),
  );
  await saveTestCase(
    request,
    rule,
    '{"name":"Seven","inputs":{"amount":7},"expectedResult":7.00}',
  );
  await saveTestCase(
    request,
    rule,
    '{"name":"Wrong eight","inputs":{"amount":8},"expectedResult":9}',
  );
  await selectRule(page, rule);
  const comparison = page.locator(".saved-test-comparison");

  await loadSavedTest(page, "Seven");
  await expect(
    page.getByLabel("API input JSON", { exact: true }),
  ).toBeVisible();
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/execute") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({ inputs: { amount: 7 } });
  // Numbers compare by value: 7 meets an expected 7.00.
  await expect(comparison).toHaveText("Matches the saved test “Seven”.");

  await loadSavedTest(page, "Wrong eight");
  await expect(comparison).toHaveCount(0);
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(comparison).toHaveText(
    "Differs from the saved test “Wrong eight”: Returned 8, expected 9",
  );

  // Edited inputs are no longer the test's, so nothing is compared.
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("9");
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(page.getByTestId("api-response")).toContainText('"result": 9');
  await expect(comparison).toHaveCount(0);
});

test("a rule without saved tests says how to add one, and reads them only when asked", async ({
  page,
  request,
}) => {
  const rule = await publishRule(
    request,
    await createRule(request, {
      id: uniqueId("playground-no-tests"),
      name: `No tests ${uniqueId("p")}`,
      definition: inputToOutput,
    }),
  );
  const reads: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname.endsWith("/test-cases"))
      reads.push(sent.url());
  });
  await selectRule(page, rule);
  expect(reads).toEqual([]);
  await page
    .getByRole("button", { name: "Load saved test", exact: true })
    .click();
  const menu = page.getByRole("menu", { name: "Saved tests" });
  await expect(menu).toContainText("No saved tests yet");
  await expect(menu).toContainText("Save a test from the Test panel");
  expect(reads).toHaveLength(1);
});
