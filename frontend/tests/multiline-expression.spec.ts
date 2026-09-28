import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

async function createRule(request: APIRequestContext) {
  const id = `multiline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 12 },
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
        expression: "amount",
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
  const rule = (await response.json()) as Rule;
  expect(
    (
      await request.post(`/api/rules/${id}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  return rule;
}

test("multiline strings retain literal function and Formula text through typing, Tab and hover", async ({
  page,
  request,
}) => {
  const rule = await createRule(request);
  const catalog = page.waitForResponse((response) =>
    response.url().endsWith("/api/functions"),
  );
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  await expression.focus();
  await catalog;
  const formulaReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      (url.pathname === "/api/rule-summaries" &&
        url.searchParams.get("kind") === "FORMULA") ||
      url.pathname.includes(`/api/rules/${rule.id}/versions/`)
    )
      formulaReads.push(url.pathname + url.search);
  });

  for (const quote of ['"', "'"]) {
    // Escaped quotes, escaped backslashes and // remain string content.
    const prefix = `${quote}escaped \\${quote} and \\\\ // literal\n`;
    for (const literal of ["$RO", `@${rule.id}`]) {
      await setEditorText(page, expression, prefix + quote);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.type(literal);
      await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
      await page.keyboard.press("Tab");
      await expect(editorLines(expression)).toContainText(literal);
      await expect(editorLines(expression)).not.toContainText("$ROUND(");
      await expect(editorLines(expression)).not.toContainText(`@${rule.id}:1(`);
    }
    for (const literal of ["$ROUND(1, 2)", `@${rule.id}:1(amount)`]) {
      await setEditorText(page, expression, prefix + literal + quote);
      // Request hover at the very first character of the continued string line.
      await page.keyboard.press("Home");
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.press("ControlOrMeta+i");
      await expect(page.locator(".monaco-hover:visible")).toHaveCount(0);
    }
  }
  expect(formulaReads).toEqual([]);
});

test("closing multiline strings and ending comments restore normal function and Formula completion", async ({
  page,
  request,
}) => {
  const rule = await createRule(request);
  await page.goto(`/#/rules/${rule.id}?node=calculate`);
  const expression = page.getByLabel("Expression", { exact: true });
  const suggestions = page.locator(".suggest-widget.visible");
  for (const prefix of [
    '"first\nsecond" + ',
    "'first\nsecond' + ",
    "// comment\n",
  ]) {
    await setEditorText(page, expression, prefix);
    await page.keyboard.type("$ROUN");
    await expect(
      suggestions.getByRole("option", {
        name: "$ROUND, Function",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(editorLines(expression)).toContainText("$ROUND(amount, 2)");
    await page.keyboard.press("Escape");
    await setEditorText(page, expression, prefix);
    // An expression edit keeps the scope read at load: no read precedes the suggestion.
    await page.keyboard.type(`@${rule.id}`);
    await expect(
      suggestions.getByRole("option", { name: new RegExp(`@${rule.id}:1`) }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(editorLines(expression)).toContainText(
      `@${rule.id}:1(amount)`,
    );
    await page.keyboard.press("Escape");
  }
});
