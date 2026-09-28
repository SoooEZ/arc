import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

async function createCondition(request: APIRequestContext, when: string) {
  const id = `condition-builder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const number = (name: string, defaultValue: number) => ({
    name,
    type: "NUMBER" as const,
    required: false,
    defaultValue,
  });
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      number("amount", 150),
      number("order_total", 120),
      number("android", 5),
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "check",
        type: "CONDITION",
        label: "Check",
        expression: when,
        position: { x: 250, y: 170 },
      },
      {
        id: "yes",
        type: "OUTPUT",
        label: "Yes",
        expression: "1",
        position: { x: 0, y: 340 },
      },
      {
        id: "no",
        type: "OUTPUT",
        label: "No",
        expression: "0",
        position: { x: 500, y: 340 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "check", sourceHandle: "next" },
      { id: "met", source: "check", target: "yes", sourceHandle: "true" },
      { id: "unmet", source: "check", target: "no", sourceHandle: "false" },
    ],
  };
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "RULE", definition },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Rule;
}

async function savedCondition(request: APIRequestContext, id: string) {
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  return saved.draft.nodes.find((node) => node.id === "check")!.expression;
}

test("the builder stays open while typing operands that pass through and/or or an open quote", async ({
  page,
  request,
}) => {
  const rule = await createCondition(request, "amount >= 100");
  await page.goto(`/#/rules/${rule.id}?node=check`);
  const inspector = page.locator(".inspector-sidebar");
  const when = inspector.getByLabel("When", { exact: true });
  const preview = inspector.locator(".condition-builder .expression-preview");
  await expect(when).toHaveValue("amount");
  for (const name of ["order_total", "android"]) {
    await when.click();
    await page.keyboard.press("ControlOrMeta+a");
    // "or >= 100" and "and >= 100" are not single comparisons.
    await page.keyboard.type(name);
    await expect(when).toBeFocused();
    await expect(when).toHaveValue(name);
    await expect(preview).toHaveText(`${name} >= 100`);
    await page.keyboard.press("Escape");
  }
  await inspector
    .getByRole("combobox", {
      name: "Comparison value · value source",
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  const value = inspector.getByLabel("Comparison value", { exact: true });
  await setEditorText(page, value, "'a");
  await expect(preview).toHaveText("android >= 'a");
  await expect(when).toHaveValue("android");
  await expect(editorLines(value)).toHaveText("'a");
  await setEditorText(page, value, "200");
  await expect(preview).toHaveText("android >= 200");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(await savedCondition(request, rule.id)).toBe("android >= 200");
});

test("the full condition editor stays open when an edit makes the expression a single comparison", async ({
  page,
  request,
}) => {
  const rule = await createCondition(request, "amount > 1 && amount < 10");
  await page.goto(`/#/rules/${rule.id}?node=check`);
  const inspector = page.locator(".inspector-sidebar");
  const expression = inspector.getByLabel("Expression", { exact: true });
  const toBuilder = inspector.getByRole("button", {
    name: "Builder",
    exact: true,
  });
  await expect(editorLines(expression)).toHaveText("amount > 1 && amount < 10");
  await expect(toBuilder).toHaveCount(0);
  await setEditorText(page, expression, "amount > 1");
  await expect(editorLines(expression)).toHaveText("amount > 1");
  await expect(inspector.getByLabel("When", { exact: true })).toHaveCount(0);
  await page.keyboard.type(" && amount < 5");
  await expect(editorLines(expression)).toHaveText("amount > 1 && amount < 5");
  await setEditorText(page, expression, "amount > 2");
  await toBuilder.click();
  await expect(inspector.getByLabel("When", { exact: true })).toHaveValue(
    "amount",
  );
  await expect(
    inspector.getByRole("combobox", { name: "Operator", exact: true }),
  ).toHaveText("Greater than");
  await expect(
    inspector.getByLabel("Comparison value", { exact: true }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(await savedCondition(request, rule.id)).toBe("amount > 2");
});
