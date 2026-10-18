import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";
import { editorLines } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    { name: "tier", type: "STRING", required: false, defaultValue: "basic" },
    { name: "vip", type: "BOOLEAN", required: false, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount * 2",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

test("the Test panel opens on a form that edits the input JSON, and can leave inputs out or send null", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("input-form"),
    definition,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Form", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const amount = page.getByRole("textbox", { name: "amount", exact: true });
  // The sample fills required inputs and defaults; vip is left out.
  await expect(amount).toHaveValue("150");
  await expect(page.getByRole("combobox", { name: "vip · send" })).toHaveText(
    "Leave out",
  );
  await amount.fill("12.50");
  const sent = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/preview"),
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  expect((await sent).postDataJSON().inputs).toEqual({
    amount: 12.5,
    tier: "basic",
  });
  await expect(page.getByTestId("test-result")).toHaveText("25.00");

  // A number that is not one stays in its field and changes nothing.
  await amount.fill("12.5x");
  await expect(page.getByText("Enter a number", { exact: true })).toBeVisible();
  // tier: null; vip: true; then back to JSON, which shows every choice.
  await page.getByRole("combobox", { name: "tier · send" }).click();
  await page.getByRole("option", { name: "null", exact: true }).click();
  await page.getByRole("combobox", { name: "vip", exact: true }).click();
  await page.getByRole("option", { name: "true", exact: true }).click();
  await page.getByRole("tab", { name: "Input JSON", exact: true }).click();
  const json = page.getByLabel("Test input JSON", { exact: true });
  await expect(editorLines(json)).toContainText('"amount": 12.50');
  await expect(editorLines(json)).toContainText('"tier": null');
  await expect(editorLines(json)).toContainText('"vip": true');

  // Leaving an input out removes its key.
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await page.getByRole("combobox", { name: "tier · send" }).click();
  await page.getByRole("option", { name: "Leave out", exact: true }).click();
  await expect(
    page.getByText('Left out: uses the default "basic"'),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Input JSON", exact: true }).click();
  await expect(editorLines(json)).not.toContainText('"tier"');
});

test("an input buffer that is not a JSON object sends the form back to the JSON view", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("input-form-json"),
    definition,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("tab", { name: "Input JSON", exact: true }).click();
  const json = page.getByLabel("Test input JSON", { exact: true });
  await json.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("[1");
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await expect(
    page.getByText("The input JSON is not a JSON object yet."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "amount" })).toHaveCount(0);
});
