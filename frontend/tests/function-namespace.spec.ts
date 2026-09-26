import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

async function create(request: APIRequestContext) {
  const id = `function-namespace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "ROUND", type: "NUMBER", required: true, defaultValue: 3.6 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "calculate",
        type: "FORMULA",
        label: "Calculate",
        expression: "ROUND",
        output: "result",
        position: { x: 250, y: 160 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Output",
        expression: "result",
        position: { x: 250, y: 320 },
      },
    ],
    edges: [
      {
        id: "start",
        source: "input",
        target: "calculate",
        sourceHandle: "next",
      },
      { id: "end", source: "calculate", target: "out", sourceHandle: "next" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Rule;
}

test("function namespace separates same-named inputs and preserves snippet arguments through execution", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  const suggestions = page.locator(".suggest-widget.visible");
  await setEditorText(page, expression, "");
  await page.keyboard.type("ROU");
  const variable = suggestions.getByRole("option", {
    name: "ROUND, Variable",
    exact: true,
  });
  await expect(variable).toBeVisible();
  await variable.click();
  await expect(editorLines(expression)).toHaveText("ROUND");
  await setEditorText(page, expression, "");
  await page.keyboard.type("$");
  await expect(suggestions.getByRole("option").first()).toContainText("$");
  await expect(
    suggestions.getByRole("option", { name: "ROUND, Variable", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.type("RO");
  await expect(editorLines(expression)).toHaveText("$RO");
  await expect(
    suggestions.getByRole("option", { name: "$ROUND, Function", exact: true }),
  ).toBeVisible();
  await expect(
    suggestions.getByRole("option", { name: "$OR, Function", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.type("UN");
  await expect(editorLines(expression)).toHaveText("$ROUN");
  await page.keyboard.press("Tab");
  await expect(editorLines(expression)).toHaveText("$ROUND(amount, 2)");
  await page.keyboard.insertText("ROUND");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("0");
  await page.keyboard.press("Escape");
  await expect(editorLines(expression)).toHaveText("$ROUND(ROUND, 0)");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(
    saved.draft.nodes.find((node) => node.id === "calculate")?.expression,
  ).toBe("$ROUND(ROUND, 0)");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("4");
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText(
    "let result = $ROUND(ROUND, 0);",
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  await expect(page.getByText("Code built. Graph is valid.")).toBeVisible();
});

test("a function catalog arriving after dollar entry refreshes only namespaced suggestions", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/functions", async (route) => {
    started();
    await blocked;
    await route.continue();
  });
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await requested;
  await page.keyboard.type("$");
  release();
  const suggestions = page.locator(".suggest-widget.visible");
  await expect(suggestions.getByRole("option").first()).toContainText("$");
  await expect(
    suggestions.getByRole("option", { name: "ROUND, Variable", exact: true }),
  ).toHaveCount(0);
  await expect(editorLines(expression)).toHaveText("$");
  await page.keyboard.type("RO");
  await expect(editorLines(expression)).toHaveText("$RO");
  await expect(
    suggestions.getByRole("option", { name: "$ROUND, Function", exact: true }),
  ).toBeVisible();
  await expect(
    suggestions.getByRole("option", { name: "$OR, Function", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.type("UN");
  await expect(editorLines(expression)).toHaveText("$ROUN");
  await page.keyboard.press("Tab");
  await expect(editorLines(expression)).toHaveText("$ROUND(amount, 2)");
});

test("nested function library snippets and module defaults retain literal dollar prefixes", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /Expression editor/ });
  const expression = dialog.getByLabel("Expression code editor", {
    exact: true,
  });
  await setEditorText(page, expression, "");
  await dialog.getByPlaceholder("Search functions…").fill("$MERGE");
  const merge = dialog.getByRole("button", { name: "$MERGE", exact: true });
  await merge.hover();
  await expect(page.getByRole("tooltip")).toContainText("$MERGE(");
  await merge.click();
  await expect(editorLines(expression)).toContainText("$MERGE(");
  await expect(editorLines(expression)).toContainText("$OBJECT(");
  await page.keyboard.insertText('$OBJECT("left", ROUND)');
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("right");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("2");
  await page.keyboard.press("Escape");
  await expect(editorLines(expression)).toHaveText(
    '$MERGE($OBJECT("left", ROUND), $OBJECT("right", 2))',
  );
  await dialog
    .getByRole("button", { name: "Apply expression", exact: true })
    .click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await page.getByRole("button", { name: "modules", exact: true }).click();
  await page
    .getByRole("button", { name: "Transform data +", exact: true })
    .click();
  await expect(page.locator(".view-lines")).toContainText(
    "$UPPER($TRIM(customer.name))",
  );
  await expect(page.locator(".view-lines")).toContainText(
    "$TO_NUMBER(customer.amount)",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Formula +", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText(
    "$ROUND(amount * 1.2, 2)",
  );
  // The template still has editable tab stops after escaping its function marker.
  await page.keyboard.insertText("round_amount");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Round amount");
  await expect(page.locator(".view-lines")).toContainText(
    'node "round_amount" FORMULA "Round amount"',
  );
});

test("late function help still completes a bare prefix without changing same-named variables", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/functions", async (route) => {
    started();
    await blocked;
    await route.continue();
  });
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await requested;
  await page.keyboard.type("ROU");
  release();
  const suggestions = page.locator(".suggest-widget.visible");
  const functionOption = suggestions.getByRole("option", {
    name: "$ROUND, Function",
    exact: true,
  });
  await expect(functionOption).toBeVisible();
  await expect(
    suggestions.getByRole("option", { name: "ROUND, Variable", exact: true }),
  ).toBeVisible();
  await expect(editorLines(expression)).toHaveText("ROU");
  await functionOption.click();
  await expect(editorLines(expression)).toHaveText("$ROUND(amount, 2)");
});

test("dollar signs inside strings and comments do not trigger function insertion", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  const catalog = page.waitForResponse((response) =>
    response.url().endsWith("/api/functions"),
  );
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await catalog;
  for (const prefix of ["'cost ", '"cost ', "// cost "]) {
    await setEditorText(page, expression, "");
    await page.keyboard.type(prefix + "$RO");
    await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(editorLines(expression)).toContainText(prefix + "$RO");
    await expect(editorLines(expression)).not.toContainText("$ROUND(");
  }
});
