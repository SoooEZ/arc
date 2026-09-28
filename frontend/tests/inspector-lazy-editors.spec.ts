import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";
import { createRule, uniqueId } from "./helpers/api";

async function create(request: APIRequestContext) {
  const id = uniqueId("lazy-inspector");
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate",
        expression: "amount * 2",
        output: "total",
        position: { x: 250, y: 170 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Return",
        expression: "total",
        position: { x: 250, y: 340 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "end", source: "calc", target: "out", sourceHandle: "next" },
    ],
  };
  const response = await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  return response;
}

async function saveAndRead(page: Page, request: APIRequestContext, id: string) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  return saved.draft.nodes.find((node) => node.id === "calc")!;
}

test("an inline expression editor that fails to load leaves the inspector and draft editable", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.route(/\/assets\/InlineExpressionEditor-[^/]+\.js$/, (route) =>
    route.abort("failed"),
  );
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const inspector = page.locator(".inspector-sidebar");
  const failure = inspector
    .getByRole("alert")
    .filter({ hasText: "Could not load the expression editor" });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("reload the page");
  await inspector
    .getByLabel("Result variable", { exact: true })
    .fill("doubled");
  await inspector
    .getByLabel("Node name", { exact: true })
    .fill("Double the amount");
  await expect(page.locator('.react-flow__node[data-id="calc"]')).toContainText(
    "Double the amount",
  );
  const saved = await saveAndRead(page, request, rule.id);
  expect(saved.output).toBe("doubled");
  expect(saved.label).toBe("Double the amount");
});

test("an expression dialog that fails to load keeps the inline editor working", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.route(/\/assets\/ExpressionDialog-[^/]+\.js$/, (route) =>
    route.abort("failed"),
  );
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const inspector = page.locator(".inspector-sidebar");
  const expression = inspector.getByLabel("Expression", { exact: true });
  await expect(editorLines(expression)).toHaveText("amount * 2");
  await inspector
    .getByRole("button", { name: "Open in Editor · Expression", exact: true })
    .click();
  const failure = inspector
    .getByRole("alert")
    .filter({ hasText: "Could not load the expression editor" });
  await expect(failure).toBeVisible();
  // The message replaces the dialog and its close button, so it offers Close.
  await failure.getByRole("button", { name: "Close", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await setEditorText(page, expression, "amount * 3");
  await expect(editorLines(expression)).toHaveText("amount * 3");
  expect((await saveAndRead(page, request, rule.id)).expression).toBe(
    "amount * 3",
  );
});
