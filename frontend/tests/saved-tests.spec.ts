import { expect, test, type Page } from "@playwright/test";
import type { Definition, TestCase } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";
import { setEditorText } from "./helpers/editor";

const doubler: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Double",
      expression: "amount * 2",
      output: "total",
      position: { x: 0, y: 160 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Total",
      expression: "total",
      position: { x: 0, y: 320 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "calc", sourceHandle: "next" },
    { id: "b", source: "calc", target: "out", sourceHandle: "next" },
  ],
};

const savedRows = (page: Page) =>
  page.getByRole("list", { name: "Saved tests" }).getByRole("listitem");

test("a run saved as a test runs again, catches a change and goes to the publish review", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("saved-tests"),
    definition: doubler,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();

  // A result becomes a test that expects it, named after its inputs.
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("3");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("6");
  await page.getByRole("button", { name: "Save as test", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Save as test" });
  await expect(dialog.getByLabel("Test name")).toHaveValue("amount 3");
  await expect(dialog.getByLabel("Expected result · JSON")).toHaveValue("6");
  await dialog.getByRole("button", { name: "Save test", exact: true }).click();
  // Try inputs stays open for the next case; the saved run's action leads to the list.
  await expect(
    page.getByRole("button", { name: "Saved tests · 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved · View tests", exact: true }),
  ).toBeVisible();

  // A failure becomes a test that expects the failure.
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.locator(".test-output .MuiAlert-root")).toContainText(
    "Missing required input: amount",
  );
  await page.getByRole("button", { name: "Save as test", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Save as test" });
  await expect(dialog.getByLabel("The error message contains")).toHaveValue(
    /Missing required input: amount/,
  );
  await dialog.getByLabel("Test name").fill("No amount");
  await dialog.getByRole("button", { name: "Save test", exact: true }).click();
  await page
    .getByRole("button", { name: "Saved · View tests", exact: true })
    .click();
  await expect(savedRows(page)).toHaveCount(2);
  await expect(savedRows(page).first()).toContainText("Returns 6");
  // Each test was saved from a run of this graph, so it has passed already.
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "2 passed · 0 failed",
  );

  const stored = (await (
    await request.get(`/api/rules/${rule.id}/test-cases`)
  ).json()) as TestCase[];
  expect(
    stored.map(({ name, inputs, expectedResult, expectedError }) => ({
      name,
      inputs,
      expectedResult,
      expectedError,
    })),
  ).toEqual([
    {
      name: "amount 3",
      inputs: { amount: 3 },
      expectedResult: 6,
      expectedError: null,
    },
    {
      name: "No amount",
      inputs: {},
      expectedResult: null,
      expectedError: expect.stringContaining("Missing required input: amount"),
    },
  ]);

  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "2 passed · 0 failed",
  );

  // A changed formula fails the first test, which can take the new result.
  await page.locator('.react-flow__node[data-id="calc"]').click();
  await setEditorText(
    page,
    page.getByLabel("Expression", { exact: true }),
    "amount * 3",
  );
  await expect(page.locator(".saved-test-pending")).toHaveCount(2);
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "1 passed · 1 failed",
  );
  await expect(
    page.getByRole("button", { name: "Saved tests · 2 · 1 failed" }),
  ).toBeVisible();
  await expect(savedRows(page).first()).toContainText("Returned 9, expected 6");

  // Publishing runs the tests against the reviewed draft and holds a failure.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Publish version 1" });
  await expect(review).toContainText("1 of 2 saved tests fail");
  await expect(review).toContainText("amount 3: Returned 9, expected 6");
  const publish = review.getByRole("button", { name: "Publish v1" });
  await expect(publish).toBeDisabled();
  await review.getByLabel("Publish anyway").check();
  await expect(publish).toBeEnabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();

  await savedRows(page)
    .first()
    .getByRole("button", { name: "Expect this result", exact: true })
    .click();
  await expect(savedRows(page).first()).toContainText("Returns 9");
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "2 passed · 0 failed",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Publish version 1" }),
  ).toContainText("All 2 saved tests pass.");
  await page
    .getByRole("dialog", { name: "Publish version 1" })
    .getByRole("button", { name: "Publish v1", exact: true })
    .click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();

  // Opening a test runs its inputs in Try inputs; deleting one asks first.
  await page.getByRole("button", { name: /^Saved tests/ }).click();
  await page
    .getByRole("button", { name: "Open amount 3", exact: true })
    .click();
  await expect(page.getByTestId("test-result")).toHaveText("9");
  await page.getByRole("button", { name: /^Saved tests/ }).click();
  page.once("dialog", (confirm) => void confirm.accept());
  await page
    .getByRole("button", { name: "Delete No amount", exact: true })
    .click();
  await expect(savedRows(page)).toHaveCount(1);
  await saveRunIsOfferedOnlyForTheDraft(page, rule.id);
});

/** A published version's run offers no Save as test, but its saved tests run. */
async function saveRunIsOfferedOnlyForTheDraft(page: Page, id: string) {
  await page.goto(`/#/rules/${id}?version=1`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("2");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("6");
  await expect(
    page.getByRole("button", { name: "Save as test", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Saved tests/ }).click();
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "1 passed · 0 failed",
  );
}

test("a field whose text is not a number holds the run and takes the focus", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("saved-tests-invalid"),
    definition: doubler,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const amount = page.getByRole("textbox", { name: "amount", exact: true });
  await amount.fill("12a");
  let previews = 0;
  page.on("request", (sent) => {
    if (sent.url().endsWith("/api/preview")) previews++;
  });
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.locator(".test-output")).toContainText(
    "Fix the marked input before running: amount.",
  );
  await expect(amount).toBeFocused();
  expect(previews).toBe(0);
  await amount.fill("12");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("24");
});

test("saved tests refuse what the server refuses, with its message", async ({
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("saved-tests-api"),
    definition: doubler,
  });
  const both = await request.post(`/api/rules/${rule.id}/test-cases`, {
    data: {
      name: "Both",
      inputs: {},
      expectedResult: 1,
      expectedError: "boom",
    },
  });
  expect(both.status()).toBe(422);
  expect((await both.json()).message).toBe(
    "A test case expects a result or an error, not both",
  );
  const unknown = await request.put(`/api/rules/${rule.id}/test-cases/1`, {
    data: { name: "None", inputs: {}, expectedResult: null },
  });
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).message).toBe("Test case not found: 1");
});

test("saving a test needs a name and JSON the server accepts", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("saved-tests-dialog"),
    definition: doubler,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("textbox", { name: "amount", exact: true }).fill("1");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("2");
  await page.getByRole("button", { name: "Save as test", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save as test" });
  const save = dialog.getByRole("button", { name: "Save test", exact: true });
  await dialog.getByLabel("Test name").fill("  ");
  await expect(dialog).toContainText(
    "Test case name must contain 1 to 160 characters",
  );
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Test name").fill("Doubles one");
  await dialog.getByLabel("Expected result · JSON").fill("{");
  await expect(dialog).toContainText("Enter the result as JSON");
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Expected result · JSON").fill("2.00");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Saved · View tests", exact: true })
    .click();
  await expect(savedRows(page)).toHaveCount(1);
  // 2.00 and 2 are one value: the run it was saved from passes it, and so does a new run.
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "1 passed · 0 failed",
  );
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await expect(page.locator(".saved-tests-summary")).toHaveText(
    "1 passed · 0 failed",
  );
});
