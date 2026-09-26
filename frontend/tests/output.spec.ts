import { editorLines, setEditorText } from "./helpers/editor";
import { expect, test, type Page } from "@playwright/test";
import type { Definition } from "../src/types";
async function select(page: Page, label: string, option: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}
async function focusOutput(page: Page) {
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Return result/ })
    .click();
}

test("Output selects values of any type and round-trips typed constants through code and versions", async ({
  page,
  request,
}) => {
  const id = `output-e2e-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
      {
        name: "customer",
        type: "OBJECT",
        required: true,
        defaultValue: { name: "Ada", active: true },
      },
      { name: "items", type: "ARRAY", required: true, defaultValue: [1, 2, 3] },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 280, y: 0 },
      },
      {
        id: "calculate",
        type: "FORMULA",
        label: "Double amount",
        expression: "amount * 2",
        output: "total",
        position: { x: 280, y: 160 },
      },
      {
        id: "result",
        type: "OUTPUT",
        label: "Return result",
        expression: "total",
        position: { x: 280, y: 320 },
      },
    ],
    edges: [
      {
        id: "start",
        source: "input",
        target: "calculate",
        sourceHandle: "next",
      },
      {
        id: "finish",
        source: "calculate",
        target: "result",
        sourceHandle: "next",
      },
    ],
  };
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: "Output selection", kind: "FORMULA", definition },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${id}`);
  await focusOutput(page);
  await expect(
    page.getByLabel("Return value · value source", { exact: true }),
  ).toHaveText("Upstream variable");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const run = async (expected: unknown) => {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText(
      JSON.stringify(expected),
    );
  };
  await run(20);
  await select(page, "Return value", "customer (object) - Inputs");
  await run({ name: "Ada", active: true });
  await select(page, "Return value", "items (array) - Inputs");
  await run([1, 2, 3]);
  await select(page, "Return value", "total (result) - Double amount");
  await run(20);
  await select(page, "Return value · value source", "Constant");
  await select(page, "Constant type", "number");
  await page.getByLabel("Return value", { exact: true }).fill("42.5");
  await run(42.5);
  await select(page, "Constant type", "boolean");
  await select(page, "Return value", "true");
  await run(true);
  await select(page, "Return value", "false");
  await run(false);
  await select(page, "Constant type", "null");
  await run(null);
  await select(page, "Constant type", "array");
  await page
    .getByLabel("Return value", { exact: true })
    .fill('[1, "two", false, null]');
  await run([1, "two", false, null]);
  await select(page, "Return value · value source", "Expression");
  await setEditorText(
    page,
    page.getByLabel("Return value", { exact: true }),
    "total + 5",
  );
  await run(25);
  await select(page, "Return value · value source", "Constant");
  await select(page, "Constant type", "string");
  const text = 'SUM(amount) · "quoted" \\ 😀';
  await page.getByLabel("Return value", { exact: true }).fill(text);
  await run(text);
  await expect(
    page.getByText("Text value · no quotation marks needed"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(
    editorLines(page.getByLabel("ARC code editor", { exact: true })),
  ).toContainText(`return ${JSON.stringify(text)}`);
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page.getByLabel("Return value", { exact: true })).toHaveValue(
    text,
  );
  await page.reload();
  await focusOutput(page);
  await expect(page.getByLabel("Constant type", { exact: true })).toHaveText(
    "string",
  );
  await expect(page.getByLabel("Return value", { exact: true })).toHaveValue(
    text,
  );
  await page.getByLabel("Return value", { exact: true }).fill("");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await run("");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const execution = await (
    await request.post(`/api/rules/${id}/execute`, { data: { inputs: {} } })
  ).json();
  expect(execution.result).toBe("");
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await page
    .locator(".version-bar")
    .getByRole("button", { name: /v1/ })
    .click();
  await focusOutput(page);
  await expect(
    page.getByLabel("Return value · value source", { exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Return value", { exact: true })).toBeDisabled();
});
