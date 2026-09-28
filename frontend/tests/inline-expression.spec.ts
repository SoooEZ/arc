import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, editorSurface, setEditorText } from "./helpers/editor";
import {
  installRenderProbe,
  renderCounts,
  resetRenderCounts,
} from "./helpers/renderProbe";

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

test("focusing an expression preserves the label notch and field geometry", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const editor = page.getByLabel("Case 1 condition", { exact: true });
  await expect(editorLines(editor)).toHaveText("hello.a == 1");
  const field = page.locator(".inline-expression-editor").filter({
    has: page.locator("legend", { hasText: "Case 1 condition" }),
  });
  await field.scrollIntoViewIfNeeded();
  const before = await field.boundingBox();
  const labelBefore = await field.locator("legend").boundingBox();
  await editor.focus();
  await expect(editor).toBeFocused();
  await expect(field).toHaveCSS("border-top-color", "rgb(27, 122, 96)");
  // A continuous outer shadow ignores the native legend notch and draws a
  // horizontal line through the label; the fieldset border respects it.
  await expect(field).toHaveCSS("box-shadow", "none");
  expect(await field.boundingBox()).toEqual(before);
  expect(await field.locator("legend").boundingBox()).toEqual(labelBefore);
  const focusedImage = await field.screenshot({
    path: test.info().outputPath("focused-expression-label.png"),
  });
  const crossesLabelNotch = await page.evaluate(
    async ({ image, x, y }) => {
      const bitmap = new Image();
      bitmap.src = `data:image/png;base64,${image}`;
      await bitmap.decode();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      // The label's left padding is blank. A green pixel here means the
      // focus line crosses the notch instead of stopping at the label.
      const pixels = context.getImageData(x, y - 2, 1, 5).data;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] < 100 && pixels[offset + 1] > pixels[offset] + 30)
          return true;
      }
      return false;
    },
    {
      image: focusedImage.toString("base64"),
      x: Math.round(labelBefore!.x - before!.x + 1),
      y: Math.floor(labelBefore!.height / 2),
    },
  );
  expect(crossesLabelNotch).toBe(false);
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
  const openEditor = page.getByRole("button", {
    name: "Open in Editor · Case 1 condition",
    exact: true,
  });
  await expect(openEditor).toBeEnabled();
  await openEditor.click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Case 1 condition",
    exact: true,
  });
  const expandedEditor = dialog.getByLabel("Expression code editor", {
    exact: true,
  });
  await expect(editorLines(expandedEditor)).toHaveText("hello.a == 1");
  await expandedEditor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("false");
  await expect(editorLines(expandedEditor)).toHaveText("hello.a == 1");
  await expect(
    dialog.getByRole("button", { name: "Apply expression", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
    // An expression edit reads diagnostics; the scope depends on structure only.
    const scope = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/diagnostics")) return false;
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

test("typing beside twenty inline editors hands Monaco no new options object", async ({
  page,
  request,
}) => {
  await installRenderProbe(page);
  const id = `inline-expression-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose",
        cases: Array.from({ length: 20 }, (_, index) => ({
          id: `case-${index + 1}`,
          label: `Case ${index + 1}`,
          expression: `amount > ${index}`,
        })),
        position: { x: 300, y: 200 },
      },
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "choose" },
    ],
  };
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/#/rules/${id}?node=choose`);
  const label = page.getByLabel("Case 1 label", { exact: true });
  await expect(label).toHaveValue("Case 1");
  await expect(
    page.getByLabel("Case 20 condition", { exact: true }),
  ).toBeVisible();
  await label.click();
  await page.keyboard.press("End");
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 60 });
  await expect(label).toHaveValue("Case 10123456789");
  const counts = await renderCounts(page);
  // Every render handed each editor a new options object: 400 global configuration
  // changes for 10 keystrokes, a cost quadratic in the number of editors.
  expect(counts.optionsChanges).toBe(0);
  expect(counts.commits).toBeGreaterThanOrEqual(10);
});

test("typing in Code studio with the Test panel open flips no editor option", async ({
  page,
  request,
}) => {
  await installRenderProbe(page);
  const rule = await create(request);
  await page.goto(`/#/studio/${rule.id}`);
  const code = page.getByRole("textbox", {
    name: "ARC code editor",
    exact: true,
  });
  await expect(code).toBeVisible();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await expect(
    page.getByLabel("Test input JSON", { exact: true }),
  ).toBeVisible();
  await code.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("End");
  await resetRenderCounts(page);
  await page.keyboard.type("\n// noted", { delay: 40 });
  await expect(editorLines(code)).toContainText("// noted");
  const counts = await renderCounts(page);
  expect(counts.optionsChanges).toBe(0);
  expect(counts.commits).toBeGreaterThan(0);
});
