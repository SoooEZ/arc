import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 300, y: 0 } },
    {
      id: "calculate",
      type: "FORMULA",
      label: "Calculation",
      expression: "amount * 2",
      output: "total",
      position: { x: 300, y: 180 },
    },
    {
      id: "output",
      type: "OUTPUT",
      label: "Result",
      expression: "total",
      position: { x: 300, y: 360 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "calculate", sourceHandle: "next" },
    { id: "b", source: "calculate", target: "output", sourceHandle: "next" },
  ],
};

async function openRule(
  page: Page,
  request: APIRequestContext,
  prefix: string,
) {
  const id = uniqueId(`${prefix}`);
  await createRule(request, {
    id,
    name: `Preview ${id}`,
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  return id;
}

const inputJson = (page: Page) =>
  page.getByLabel("Test input JSON", { exact: true });
const result = (page: Page) => page.getByTestId("test-result");
const traceSwitch = (page: Page) =>
  page.getByLabel("Include execution trace", { exact: true });
const timeout = (page: Page) =>
  page.getByLabel("Execution timeout", { exact: true });

test("preview inputs, options and result survive view switches and unbuilt code", async ({
  page,
  request,
}) => {
  const id = await openRule(page, request, "preview-views");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await setEditorText(page, inputJson(page), '{"amount": 3}');
  await traceSwitch(page).uncheck();
  await timeout(page).click();
  await page.getByRole("option", { name: "5 seconds", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(result(page)).toHaveText("6");

  const curlTab = page.getByRole("tab", { name: "cURL", exact: true });
  await curlTab.click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
  await expect(curlTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".curl-preview pre")).toContainText('"amount": 3');
  await expect(page.locator(".curl-preview pre")).toContainText(
    '"timeoutMs": 5000',
  );
  await page.getByRole("tab", { name: "Input JSON", exact: true }).click();
  await expect(editorLines(inputJson(page))).toHaveText('{"amount": 3}');
  await expect(traceSwitch(page)).not.toBeChecked();
  await expect(timeout(page)).toHaveText("5 seconds");
  await expect(result(page)).toHaveText("6");

  // Unbuilt code keeps the panel and its inputs; preview waits for a build.
  const code = page.getByRole("textbox", {
    name: "ARC code editor",
    exact: true,
  });
  await code.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n// unbuilt note");
  await expect(page.getByText("Build to test these changes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run test", exact: true }),
  ).toBeDisabled();
  await expect(editorLines(inputJson(page))).toHaveText('{"amount": 3}');

  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
  await expect(editorLines(inputJson(page))).toHaveText('{"amount": 3}');
  await expect(traceSwitch(page)).not.toBeChecked();
  await expect(timeout(page)).toHaveText("5 seconds");
  const sent = page.waitForRequest((req) => req.url().endsWith("/api/preview"));
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    inputs: { amount: 3 },
    trace: false,
    timeoutMs: 5000,
  });
  await expect(result(page)).toHaveText("6");
});

test("moving a card keeps the preview result and its trace until the graph changes", async ({
  page,
  request,
}) => {
  await openRule(page, request, "preview-drag");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(result(page)).toHaveText("20");
  await expect(page.locator(".node-visited")).toHaveCount(3);
  // The open Test panel covers the lower cards; Calculation stays visible.
  const card = page.locator('.react-flow__node[data-id="calculate"]');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(result(page)).toHaveText("20");
  await expect(page.getByText("Execution path highlighted")).toBeVisible();
  await expect(page.locator(".node-visited")).toHaveCount(3);

  await page
    .locator('.react-flow__node[data-id="calculate"] .graph-node')
    .click();
  await setEditorText(
    page,
    page.getByLabel("Expression", { exact: true }),
    "amount * 3",
  );
  await expect(page.getByText("Follow the logic")).toBeVisible();
  await expect(page.locator(".node-visited")).toHaveCount(0);
});

test("saving keeps typed test inputs and the current result; an untouched sample follows the inputs", async ({
  page,
  request,
}) => {
  await openRule(page, request, "preview-save");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(editorLines(inputJson(page))).toHaveText(/"amount":\s*10/);
  // A parameter added in the browser has no `source` field; the saved
  // response lists it as null.
  await page
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await expect(editorLines(inputJson(page))).toHaveText(
    /"amount":\s*10,\s*"input2":\s*150/,
  );
  const typed = '{"amount": 500, "input2": 7}';
  await setEditorText(page, inputJson(page), typed);
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(result(page)).toHaveText("1000");

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(editorLines(inputJson(page))).toHaveText(typed);
  await expect(result(page)).toHaveText("1000");
  await expect(page.locator(".node-visited")).toHaveCount(3);

  // Editing the input schema keeps a buffer the user has typed.
  await page
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await expect(editorLines(inputJson(page))).toHaveText(typed);
});

test("Hide test closes the panel without building, even over unbuildable code", async ({
  page,
  request,
}) => {
  const id = await openRule(page, request, "preview-hide");
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/${id}$`));
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(inputJson(page)).toBeVisible();
  const code = page.getByRole("textbox", {
    name: "ARC code editor",
    exact: true,
  });
  await code.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nnode broken");
  await expect(page.getByText("Build to test these changes")).toBeVisible();
  const builds: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith("/api/studio/build"))
      builds.push(outgoing.url());
  });
  // "Hide test" built first, failed with the build error and left the panel open.
  await page.getByRole("button", { name: "Hide test", exact: true }).click();
  await expect(inputJson(page)).toHaveCount(0);
  expect(builds).toEqual([]);
  await expect(page.locator(".studio-filebar")).toContainText("edited");
  await expect(
    page.getByRole("button", { name: "Test rule", exact: true }),
  ).toBeVisible();
});

test("applying unchanged node code keeps the draft clean and its preview result", async ({
  page,
  request,
}) => {
  const id = await openRule(page, request, "preview-noop-apply");
  const revision = async () =>
    ((await (await request.get(`/api/rules/${id}`)).json()) as Rule).revision;
  const created = await revision();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await setEditorText(page, inputJson(page), '{"amount": 4}');
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(result(page)).toHaveText("8");
  const reads: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith("/api/variables")) reads.push(outgoing.url());
  });
  await page
    .getByRole("button", { name: "Node expression · Inputs", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Inputs",
    exact: true,
  });
  await expect(
    editorLines(dialog.getByLabel("Node code editor", { exact: true })),
  ).toContainText("inputs");
  // The build echo (explicit nulls, its own edge order) replaced the draft and dirtied it.
  await dialog.getByRole("button", { name: "Apply to graph" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(result(page)).toHaveText("8");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  expect(reads).toEqual([]);
  expect(await revision()).toBe(created);
});
