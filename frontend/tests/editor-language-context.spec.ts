import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 12 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calculate",
      expression: "amount * 2",
      output: "result",
      position: { x: 200, y: 180 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "result",
      position: { x: 200, y: 360 },
    },
  ],
  edges: [
    { id: "start", source: "input", target: "calc", sourceHandle: "next" },
    { id: "end", source: "calc", target: "out", sourceHandle: "next" },
  ],
};

async function create(request: APIRequestContext, publish = false) {
  const id = `editor-context-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  const rule: Rule = await response.json();
  if (publish)
    expect(
      (
        await request.post(`/api/rules/${id}/publish`, {
          data: { revision: rule.revision },
        })
      ).ok(),
    ).toBeTruthy();
  return id;
}

async function expectInputDeclarationColor(editor: Locator) {
  await expect
    .poll(() =>
      editorLines(editor).evaluate((lines) => {
        let text = "";
        const colors: string[] = [];
        const walker = document.createTreeWalker(lines, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const content = node.textContent ?? "";
          text += content;
          colors.push(
            ...Array<string>(content.length).fill(
              getComputedStyle(node.parentElement!).color,
            ),
          );
          node = walker.nextNode();
        }
        const start = text.indexOf("amount");
        return start < 0 ? [] : colors.slice(start, start + "amount".length);
      }),
    )
    .toEqual(Array<string>("amount".length).fill("rgb(32, 95, 166)"));
}

test("node code excludes graph modules while function and Formula completions remain usable", async ({
  page,
  request,
}) => {
  const callee = await create(request, true);
  const caller = await create(request);
  await page.goto(`/#/rules/${caller}?node=calc`);
  await page
    .locator(".inspector-sidebar")
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Calculate",
    exact: true,
  });
  const code = dialog.getByLabel("Node code editor", { exact: true });
  const suggestions = page.locator(".suggest-widget.visible");
  const expressionPrefix = 'node calc FORMULA "Calculate" { let result = ';
  await setEditorText(page, code, expressionPrefix);
  await page.keyboard.type("$ROUN");
  await expect(
    suggestions.getByRole("option", { name: "$ROUND, Function", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorLines(code)).toContainText("$ROUND(amount, 2)");
  await page.keyboard.press("Escape");

  const completeNode = `${expressionPrefix}amount; next -> out; }`;
  await setEditorText(page, code, completeNode + "\n");
  await page.keyboard.type("For");
  await page.keyboard.press("Control+Space");
  await expect(
    suggestions.getByRole("option", { name: "Formula, Snippet", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(editorLines(code)).not.toContainText('node "calculate"');
  await page.keyboard.press("Escape");

  await setEditorText(page, code, expressionPrefix);
  await page.keyboard.type(`@${callee}`);
  await page.keyboard.press("Control+Space");
  await expect(
    suggestions.getByRole("option", { name: new RegExp(`@${callee}:1`) }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorLines(code)).toContainText(`@${callee}:1(amount)`);
  await page.keyboard.press("Tab");
  await page.keyboard.type("; next -> out; }");
  await expect(editorLines(code)).toHaveText(
    `${expressionPrefix}@${callee}:1(amount); next -> out; }`,
  );
  await dialog.getByRole("button", { name: "Apply to graph" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    editorLines(page.getByLabel("Expression", { exact: true })),
  ).toHaveText(`@${callee}:1(amount)`);
});

test("Input node declarations keep their colors and whole-script editors retain module completion", async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/#/rules/${id}?node=input`);
  await page
    .locator(".inspector-sidebar")
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Inputs",
    exact: true,
  });
  const nodeCode = dialog.getByLabel("Node code editor", { exact: true });
  await expectInputDeclarationColor(nodeCode);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const script = page.getByLabel("ARC code editor", { exact: true });
  await expectInputDeclarationColor(script);
  await script.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("For");
  await page.keyboard.press("Control+Space");
  await expect(
    page.locator(".suggest-widget.visible").getByRole("option", {
      name: "Formula, Snippet",
      exact: true,
    }),
  ).toBeVisible();
});
