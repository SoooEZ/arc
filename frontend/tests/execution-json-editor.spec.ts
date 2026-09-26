import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    {
      name: "hello",
      type: "OBJECT",
      required: true,
      defaultValue: { a: 3 },
    },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "output",
      type: "OUTPUT",
      label: "Result",
      expression: "hello.a",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [
    { id: "next", source: "input", target: "output", sourceHandle: "next" },
  ],
};

async function createRule(request: APIRequestContext, publish = false) {
  const id = `json-editor-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(created.ok()).toBe(true);
  const rule: Rule = await created.json();
  if (publish) {
    const published = await request.post(`/api/rules/${id}/publish`, {
      data: { revision: rule.revision },
    });
    expect(published.ok()).toBe(true);
  }
  return id;
}

async function indentation(page: Page, input: Locator) {
  await setEditorText(page, input, '{\n  "hello": {\n    "a": 3\n  }\n}');
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  const line = editorLines(input).locator(".view-line").nth(1);
  await expect
    .poll(async () => (await line.innerText()).replace(/\u00a0/g, " "))
    .toBe('    "hello": {');
  await expect(input).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(async () => (await line.innerText()).replace(/\u00a0/g, " "))
    .toBe('  "hello": {');
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await line.innerText()).replace(/\u00a0/g, " "))
    .toBe('    "hello": {');
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await line.innerText()).replace(/\u00a0/g, " "))
    .toBe('  "hello": {');
}

test("preview JSON supports indentation and preserves unfinished text across cURL and input errors", async ({
  page,
  request,
}, testInfo) => {
  const id = await createRule(request);
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const input = page.getByLabel("Test input JSON", { exact: true });
  await indentation(page, input);
  const sent = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/preview"),
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  expect((await sent).postDataJSON().inputs).toEqual({ hello: { a: 3 } });
  await expect(page.getByTestId("test-result")).toHaveText("3");

  await setEditorText(page, input, '{"hello":');
  let invalidRequests = 0;
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith("/api/preview")) invalidRequests += 1;
  });
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  const editInputs = page.getByRole("button", {
    name: "Edit test inputs",
    exact: true,
  });
  await expect(editInputs).toBeVisible();
  await page.getByRole("tab", { name: "cURL", exact: true }).click();
  await editInputs.click();
  await expect(input).toBeFocused();
  await expect(editorLines(input)).toHaveText('{"hello":');
  expect(invalidRequests).toBe(0);

  await setEditorText(page, input, "{}");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type('"hello": {"a": 7}');
  await expect(editorLines(input).locator(".view-line").nth(1)).toHaveText(
    '  "hello": {"a": 7}',
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("7");
  await page.screenshot({
    path: testInfo.outputPath("preview-json-editor.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".execution-json-editor").scrollIntoViewIfNeeded();
  await expect(input).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("preview-json-editor-mobile.png"),
  });
});

test("published JSON uses the same keyboard editor and retains invalid input without sending it", async ({
  page,
  request,
}, testInfo) => {
  const id = await createRule(request, true);
  await page.goto("/#/playground");
  await page.getByLabel("Find published rules", { exact: true }).fill(id);
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page.getByRole("option", { name: id, exact: true }).click();
  const input = page.getByLabel("API input JSON", { exact: true });
  await indentation(page, input);
  const sent = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith(`/api/rules/${id}/execute`),
  );
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    version: 1,
    inputs: { hello: { a: 3 } },
  });
  await expect(page.getByTestId("api-response")).toContainText('"result": 3');
  await setEditorText(page, input, '{"hello":');
  let invalidRequests = 0;
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith(`/api/rules/${id}/execute`))
      invalidRequests += 1;
  });
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(page.locator(".api-response .MuiAlert-root")).toBeVisible();
  await expect(editorLines(input)).toHaveText('{"hello":');
  expect(invalidRequests).toBe(0);
  await page.getByLabel("Include execution trace", { exact: true }).uncheck();
  await expect(editorLines(input)).toHaveText('{"hello":');

  await setEditorText(page, input, "");
  await page.keyboard.type('{"hello":{"a":11}}');
  await expect(editorLines(input)).toHaveText('{"hello":{"a":11}}');
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(page.getByTestId("api-response")).toContainText('"result": 11');
  await page.screenshot({
    path: testInfo.outputPath("published-json-editor.png"),
  });
});
