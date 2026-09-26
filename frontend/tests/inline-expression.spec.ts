import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, editorSurface, setEditorText } from "./helpers/editor";

async function create(
  request: APIRequestContext,
  expression = "hello.a == 1",
  additionalInputs: Definition["inputs"] = [],
) {
  const id = `inline-expression-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "hello", type: "OBJECT", required: true, defaultValue: { a: 1 } },
      ...additionalInputs,
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression: "hello.a * 2",
        output: "price",
        position: { x: 300, y: 160 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose amount",
        cases: [
          { id: "one", label: "One", expression },
          { id: "two", label: "Two", expression: "hello.a == 2" },
        ],
        position: { x: 300, y: 320 },
      },
      {
        id: "one",
        type: "OUTPUT",
        label: "First result",
        expression: "1",
        position: { x: 0, y: 500 },
      },
      {
        id: "two",
        type: "OUTPUT",
        label: "Second result",
        expression: "2",
        position: { x: 300, y: 500 },
      },
      {
        id: "other",
        type: "OUTPUT",
        label: "Other result",
        expression: "3",
        position: { x: 600, y: 500 },
      },
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "calc" },
      {
        id: "calculated",
        source: "calc",
        sourceHandle: "next",
        target: "choose",
      },
      { id: "one", source: "choose", sourceHandle: "case:one", target: "one" },
      { id: "two", source: "choose", sourceHandle: "case:two", target: "two" },
      {
        id: "other",
        source: "choose",
        sourceHandle: "default",
        target: "other",
      },
    ],
  };
  const response = await request.post("/api/rules", {
    data: {
      id,
      name: `Editor ${id.slice(-5)}`,
      kind: "DECISION_TREE",
      definition,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Rule;
}

async function focusNode(page: Page, name: string) {
  if (!(await page.locator(".node-outline").isVisible()))
    await page
      .getByRole("button", { name: "Node outline", exact: true })
      .click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}

test("typed equality retains both visible characters through save, reload and execution", async ({
  page,
  request,
}) => {
  const rule = await create(request, "false");
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const condition = page.getByLabel("Case 1 condition", { exact: true });
  await setEditorText(page, condition, "hello.a");
  await page.keyboard.type(" == 1");
  await expect(editorLines(condition)).toHaveText("hello.a == 1");
  const features = await editorLines(condition).evaluate(
    (element) => getComputedStyle(element).fontFeatureSettings,
  );
  expect(features).toMatch(/"liga"\s+0/);
  expect(features).toMatch(/"calt"\s+0/);
  await editorSurface(condition).screenshot({
    path: test.info().outputPath("equality-characters.png"),
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(
    saved.draft.nodes.find((node) => node.id === "choose")?.cases?.[0]
      .expression,
  ).toBe("hello.a == 1");
  await page.reload();
  await expect(editorLines(condition)).toHaveText("hello.a == 1");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("1");
});

test("inline completion accepts scoped variables and function snippets with Tab without crossing models", async ({
  page,
  request,
}) => {
  const rule = await create(request, "hello.a == 1", [
    { name: "prism", type: "NUMBER", required: true, defaultValue: 0 },
  ]);
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  const second = page.getByLabel("Case 2 condition", { exact: true });
  const suggestions = page.locator(".suggest-widget.visible");
  await setEditorText(page, first, "");
  await page.keyboard.type("hell");
  await expect(suggestions.getByText("hello", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("inline-suggestions-desktop.png"),
  });
  await page.keyboard.press("Tab");
  await expect(editorLines(first)).toHaveText("hello");
  await expect(editorLines(second)).toHaveText("hello.a == 2");
  await setEditorText(page, first, "");
  await page.keyboard.type("$ROUND");
  await expect(
    suggestions.getByRole("option", { name: "$ROUND, Function", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorLines(first)).toHaveText("$ROUND(amount, 2)");
  await page.keyboard.insertText("hello.a");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("0");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText(" > 0");
  await expect(editorLines(first)).toHaveText("$ROUND(hello.a, 0) > 0");
  await page
    .getByRole("button", { name: "Move case 2 up", exact: true })
    .click();
  await expect(editorLines(first)).toHaveText("hello.a == 2");
  await expect(editorLines(second)).toHaveText("$ROUND(hello.a, 0) > 0");
  await setEditorText(page, first, "");
  await page.keyboard.type("pri");
  await expect(suggestions.getByText("price", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(" == 2");
  await focusNode(page, "Calculate price");
  const formula = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, formula, "");
  await page.keyboard.type("pri");
  await expect(suggestions.getByText("prism", { exact: true })).toBeVisible();
  await expect(suggestions.getByText("price", { exact: true })).toHaveCount(0);
  await setEditorText(page, formula, "hello.a * 2");
  await focusNode(page, "Choose amount");
  await expect(editorLines(first)).toHaveText("price == 2");
  await expect(editorLines(second)).toHaveText("$ROUND(hello.a, 0) > 0");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "choose")?.cases).toEqual(
    [
      { id: "two", label: "Two", expression: "price == 2" },
      { id: "one", label: "One", expression: "$ROUND(hello.a, 0) > 0" },
    ],
  );
});

test("published inline expressions reject keyboard changes and keep both equality glyphs", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  expect(
    (
      await request.post(`/api/rules/${rule.id}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const published: Rule = await (
    await request.get(`/api/rules/${rule.id}`)
  ).json();
  await page.goto(`/#/rules/${rule.id}?version=1&node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  await expect(editorLines(first)).toHaveText("hello.a == 1");
  await first.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("false");
  await expect(editorLines(first)).toHaveText("hello.a == 1");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  const after: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(after.revision).toBe(published.revision);
});

test("inline suggestions fit a narrow viewport", async ({ page, request }) => {
  const rule = await create(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  await first.scrollIntoViewIfNeeded();
  await setEditorText(page, first, "");
  await page.keyboard.type("hell");
  await expect(
    page.locator(".suggest-widget.visible").getByText("hello", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("inline-suggestions-mobile.png"),
  });
  for (const element of [
    editorSurface(first),
    page.locator(".suggest-widget.visible"),
  ]) {
    const bounds = await element.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Tab");
  await expect(editorLines(first)).toHaveText("hello");
});

test("unfinished quoted strings do not open variable or function suggestions", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  for (const quote of ["'", '"']) {
    await setEditorText(page, first, "");
    const scope = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/variables")) return false;
      const definition = response.request().postDataJSON() as Definition;
      return (
        definition.nodes
          .find((node) => node.id === "choose")
          ?.cases?.[0].expression.startsWith(quote + "hell") ?? false
      );
    });
    await page.keyboard.type(quote + "hell");
    await scope;
    await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
    await expect(editorLines(first)).toContainText(quote + "hell");
  }
});
