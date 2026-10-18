import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, inputToOutput, uniqueId } from "./helpers/api";
import { setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "weight", type: "NUMBER", required: true, defaultValue: null },
    { name: "express", type: "BOOLEAN", required: false, defaultValue: false },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "fee",
      type: "FORMULA",
      label: "Fee",
      position: { x: 0, y: 150 },
      expression: "5 + weight * 0.5",
      output: "fee",
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Out",
      position: { x: 0, y: 300 },
      expression: "fee",
    },
  ],
  edges: [
    { id: "e1", source: "input", target: "fee", sourceHandle: "next" },
    { id: "e2", source: "fee", target: "out", sourceHandle: "next" },
  ],
};

test("a new parameter's name is selected, and a parameter no step reads is marked Not used", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("unused-inputs"),
    definition,
  });
  await page.goto(`/#/rules/${rule.id}?node=input`);
  const cards = page.locator(".input-schema-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator(".input-unused")).toHaveCount(0);
  await expect(cards.nth(1).locator(".input-unused")).toHaveText("Not used");
  await cards.nth(1).locator(".input-unused").hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "No step reads express yet. Use it in an expression or a mapping, or remove it.",
  );

  // Typing replaces the generated name of a parameter Add parameter appends.
  await page
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await page.keyboard.type("destination");
  await expect(
    cards.nth(2).getByLabel("Parameter name", { exact: true }),
  ).toHaveValue("destination");
  await expect(cards.nth(2).locator(".input-unused")).toHaveText("Not used");

  // Reading a parameter anywhere clears the mark.
  await page.locator('.react-flow__node[data-id="fee"]').click();
  await setEditorText(
    page,
    page.getByLabel("Expression", { exact: true }),
    "$IF(express, 10, 5) + weight * 0.5",
  );
  await page.locator('.react-flow__node[data-id="input"]').click();
  await expect(cards.nth(1).locator(".input-unused")).toHaveCount(0);
  await expect(cards.nth(2).locator(".input-unused")).toHaveText("Not used");
  // The status bar counts in words that agree with the number.
  await expect(page.locator(".editor-status")).toContainText("3 inputs");
  await expect(page.locator(".editor-status")).toContainText("2 connections");
});

test("the canvas counts one input and one connection in the singular", async ({
  page,
  request,
}) => {
  const rule = await createRule(request, {
    id: uniqueId("singular-counts"),
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${rule.id}`);
  const status = page.locator(".editor-status");
  await expect(status).toContainText("1 input");
  await expect(status).toContainText("1 connection");
  await expect(status).not.toContainText("1 inputs");
  await expect(status).not.toContainText("1 connections");
  await expect(page.locator(".graph-view-label")).toContainText("2 nodes");
});
