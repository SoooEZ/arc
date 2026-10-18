import { expect, test } from "@playwright/test";
import {
  createRule,
  inputToOutput,
  publishRule,
  uniqueId,
} from "./helpers/api";

test("the playground fills a published rule's inputs from a form and executes from its heading", async ({
  page,
  request,
}) => {
  const rule = await publishRule(
    request,
    await createRule(request, {
      id: uniqueId("playground-form"),
      name: `Playground ${uniqueId("form")}`,
      definition: inputToOutput,
    }),
  );
  await page.goto("/#/playground");
  await page.getByLabel("Find published rules", { exact: true }).fill(rule.id);
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page.getByRole("option", { name: rule.name, exact: true }).click();
  // The command stays in sight above the request it sends.
  const execute = page
    .locator(".api-console-heading")
    .getByRole("button", { name: "Execute rule", exact: true });
  await expect(execute).toBeEnabled();
  expect((await execute.boundingBox())!.y).toBeLessThan(600);

  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("7");
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(
    page.getByLabel("API input JSON", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/execute") && req.method() === "POST",
  );
  await execute.click();
  expect((await sent).postDataJSON()).toMatchObject({
    version: 1,
    inputs: { amount: 7 },
  });
  await expect(page.getByTestId("api-response")).toContainText('"result": 7');
});
