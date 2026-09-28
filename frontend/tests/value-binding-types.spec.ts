import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule, RuleNode } from "../src/types";
import { editorLines } from "./helpers/editor";
import { createRule, publishRule, uniqueId } from "./helpers/api";

const node = (
  id: string,
  type: RuleNode["type"],
  expression?: string,
  output?: string,
  x = 200,
  y = 0,
): RuleNode => ({
  id,
  type,
  label: id,
  expression,
  output,
  position: { x, y },
});
const edge = (source: string, target: string, sourceHandle = "next") => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle,
});
async function create(request: APIRequestContext, definition: Definition) {
  const id = uniqueId("binding-types");
  const response = await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  return response;
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("an ARRAY Reference mapping keeps its literal when switching through Expression and Constant", async ({
  page,
  request,
}) => {
  const child = await create(request, {
    schemaVersion: 1,
    inputs: [
      { name: "items", type: "ARRAY", required: false, defaultValue: [] },
    ],
    nodes: [
      node("input", "INPUT"),
      node("out", "OUTPUT", "items", undefined, 200, 200),
    ],
    edges: [edge("input", "out")],
  });
  await publishRule(request, child);
  const parent = await create(request, {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      {
        ...node("reuse", "REFERENCE", undefined, "result", 200, 180),
        ruleId: child.id,
        version: 1,
        bindings: { items: "[1,2]" },
      },
      node("out", "OUTPUT", "result", undefined, 200, 360),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  });
  await page.goto(`/#/rules/${parent.id}?node=reuse`);
  await expect(
    page.getByRole("combobox", { name: "items · value source", exact: true }),
  ).toHaveText("Constant");
  await expect(page.getByLabel("items", { exact: true })).toHaveValue("[1,2]");
  await select(page, "items · value source", "Expression");
  await expect(
    editorLines(page.getByLabel("items", { exact: true })),
  ).toHaveText("[1,2]");
  await select(page, "items · value source", "Constant");
  await expect(page.getByLabel("items", { exact: true })).toHaveValue("[1,2]");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Node name", { exact: true }).fill("Reuse array");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (
    await request.get(`/api/rules/${parent.id}`)
  ).json();
  expect(
    saved.draft.nodes.find((item) => item.id === "reuse")?.bindings,
  ).toEqual({ items: "[1,2]" });
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("[1,2]");
  await page.reload();
  await expect(page.getByLabel("items", { exact: true })).toHaveValue("[1,2]");
});

for (const comparedValue of ["flag", "customer.active"]) {
  test(`a boolean comparison on ${comparedValue} shows and saves true/false controls`, async ({
    page,
    request,
  }) => {
    const rule = await create(request, {
      schemaVersion: 1,
      inputs: [
        {
          name: "customer",
          type: "OBJECT",
          required: true,
          defaultValue: { active: true },
        },
      ],
      nodes: [
        node("input", "INPUT"),
        node("calc", "FORMULA", "true", "flag", 200, 170),
        node(
          "check",
          "CONDITION",
          `${comparedValue} == true`,
          undefined,
          200,
          340,
        ),
        node("yes", "OUTPUT", "1", undefined, 0, 510),
        node("no", "OUTPUT", "0", undefined, 400, 510),
      ],
      edges: [
        edge("input", "calc"),
        edge("calc", "check"),
        edge("check", "yes", "true"),
        edge("check", "no", "false"),
      ],
    });
    await page.goto(`/#/rules/${rule.id}?node=check`);
    await expect(
      page.getByRole("combobox", { name: "Comparison value", exact: true }),
    ).toHaveText("true");
    await select(page, "Comparison value", "false");
    await expect(
      page.locator(".condition-builder .expression-preview"),
    ).toHaveText(`${comparedValue} == false`);
    await page.getByRole("button", { name: "Test rule", exact: true }).click();
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText("0");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved: Rule = await (
      await request.get(`/api/rules/${rule.id}`)
    ).json();
    expect(
      saved.draft.nodes.find((item) => item.id === "check")?.expression,
    ).toBe(`${comparedValue} == false`);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Comparison value", exact: true }),
    ).toHaveText("false");
  });
}

test("Switch scalar controls keep array/null literals as expressions and offer only scalar constant types", async ({
  page,
  request,
}) => {
  const rule = await create(request, {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      {
        ...node("choose", "SWITCH", undefined, undefined, 200, 170),
        selector: "1",
        cases: [
          { id: "array", label: "Array draft", expression: "[1,2]" },
          { id: "null", label: "Null draft", expression: "null" },
        ],
      },
      node("out", "OUTPUT", "0", undefined, 200, 380),
    ],
    edges: [edge("input", "choose"), edge("choose", "out", "default")],
  });
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const array = page.getByTestId("switch-case-array");
  const nullable = page.getByTestId("switch-case-null");
  await expect(
    array.getByRole("combobox", {
      name: "Case 1 value · value source",
      exact: true,
    }),
  ).toHaveText("Expression");
  await expect(
    editorLines(array.getByLabel("Case 1 value", { exact: true })),
  ).toHaveText("[1,2]");
  await expect(
    nullable.getByRole("combobox", {
      name: "Case 2 value · value source",
      exact: true,
    }),
  ).toHaveText("Expression");
  await expect(
    editorLines(nullable.getByLabel("Case 2 value", { exact: true })),
  ).toHaveText("null");
  await select(page, "Case 1 value · value source", "Constant");
  await array
    .getByRole("combobox", { name: "Constant type", exact: true })
    .click();
  await expect(page.getByRole("option")).toHaveText([
    "number",
    "string",
    "boolean",
  ]);
  await page.keyboard.press("Escape");
  await expect(
    editorLines(nullable.getByLabel("Case 2 value", { exact: true })),
  ).toHaveText("null");
});
