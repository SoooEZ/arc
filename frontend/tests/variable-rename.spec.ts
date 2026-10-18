import { expect, test, type Page } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, readRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    { name: "rate", type: "NUMBER", required: false, defaultValue: 0.1 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "large",
      type: "CONDITION",
      label: "Large?",
      expression: "amount >= 100",
      position: { x: 0, y: 160 },
    },
    {
      id: "discount",
      type: "FORMULA",
      label: "Discount",
      expression: "amount * (1 - rate)",
      output: "total",
      position: { x: -160, y: 320 },
    },
    {
      id: "paid",
      type: "OUTPUT",
      label: "Paid",
      expression: "total",
      position: { x: -160, y: 480 },
    },
    {
      id: "full",
      type: "OUTPUT",
      label: "Full",
      expression: "amount",
      position: { x: 160, y: 320 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "large", sourceHandle: "next" },
    { id: "b", source: "large", target: "discount", sourceHandle: "true" },
    { id: "c", source: "discount", target: "paid", sourceHandle: "next" },
    { id: "d", source: "large", target: "full", sourceHandle: "false" },
  ],
};

const card = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

/** Replaces a name field's text by typing, as a user renames. */
async function retype(page: Page, label: string, name: string) {
  const field = page.getByLabel(label, { exact: true }).first();
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.pressSequentially(name, { delay: 10 });
}

test("renaming an input or a result renames it in every expression, as one undo step", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("rename"),
    definition,
  });
  await page.goto(`/#/rules/${rule.id}?node=input`);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  await retype(page, "Parameter name", "orderTotal");
  await expect(card(page, "large")).toContainText("orderTotal >= 100");
  await expect(card(page, "full")).toContainText("orderTotal");
  await expect(page.locator(".node-error-message")).toHaveCount(0);
  // A valid name shows no naming rule under its field.
  await expect(
    page.getByText("Use letters, digits, or _", { exact: false }),
  ).toHaveCount(0);

  // The typing was one step: Undo brings the old name back everywhere.
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(card(page, "large")).toContainText("amount >= 100");
  await expect(card(page, "full")).toContainText("amount");

  // A cleared name leaves the expressions until the name is complete again.
  await card(page, "input").click();
  const name = page.getByLabel("Parameter name", { exact: true }).first();
  await name.click();
  await name.press("ControlOrMeta+a");
  await name.press("Backspace");
  await expect(card(page, "large")).toContainText("amount >= 100");
  await name.pressSequentially("price", { delay: 10 });
  await expect(card(page, "large")).toContainText("price >= 100");
  await expect(page.locator(".node-error-message")).toHaveCount(0);

  // Typing follows each complete name ("r", "ra", "rat"), but not one that
  // another input has: "rate" leaves the expressions reading "rat" until the
  // name is unique again.
  await retype(page, "Parameter name", "rate");
  await expect(card(page, "large")).toContainText("rat >= 100");
  await retype(page, "Parameter name", "subtotal");
  await expect(card(page, "large")).toContainText("subtotal >= 100");

  // A result variable renames its reads too.
  await card(page, "discount").click();
  await retype(page, "Result variable", "discounted");
  await expect(card(page, "paid")).toContainText("discounted");

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await readRule(request, rule.id);
  const nodes = Object.fromEntries(
    saved.draft.nodes.map((node) => [node.id, node]),
  );
  expect(saved.draft.inputs.map((input) => input.name)).toEqual([
    "subtotal",
    "rate",
  ]);
  expect(nodes.large.expression).toBe("subtotal >= 100");
  expect(nodes.discount.expression).toBe("subtotal * (1 - rate)");
  expect(nodes.discount.output).toBe("discounted");
  expect(nodes.paid.expression).toBe("discounted");
  expect(nodes.full.expression).toBe("subtotal");
});
