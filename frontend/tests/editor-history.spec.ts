import { expect, test, type Page } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, publishRule, readRule, uniqueId } from "./helpers/api";

/** True leads to an Output under the True exit; False has no connection yet. */
const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Check",
      expression: "amount >= 100",
      position: { x: 0, y: 160 },
    },
    {
      id: "yes",
      type: "OUTPUT",
      label: "Yes",
      expression: "amount",
      position: { x: -120, y: 345 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "check", sourceHandle: "next" },
    { id: "b", source: "check", target: "yes", sourceHandle: "true" },
  ],
};

const card = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

async function open(page: Page, request: Parameters<typeof createRule>[0]) {
  const rule = await createRule(request, {
    id: uniqueId("history"),
    kind: "DECISION_TREE",
    definition,
  });
  await page.goto(`/#/rules/${rule.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  return rule.id;
}

test("an unconnected exit adds a connected step below it, clear of the other cards", async ({
  page,
  request,
}) => {
  const id = await open(page, request);
  // Only an exit without a connection offers the next step.
  await expect(
    page.getByRole("button", { name: "Add after Check · True", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add after Check · False", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "Add after Check · False" })
    .getByRole("menuitem", { name: "Output" })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Add after Check · False", exact: true }),
  ).toHaveCount(0);
  // The toolbar's Add node finds room too.
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Formula" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  const saved = (await readRule(request, id)).draft;
  const added = saved.nodes.filter(
    (node) => !definition.nodes.some((old) => old.id === node.id),
  );
  const output = added.find((node) => node.type === "OUTPUT")!;
  expect(saved.edges).toContainEqual(
    expect.objectContaining({
      source: "check",
      target: output.id,
      sourceHandle: "false",
    }),
  );
  expect(output.position.y).toBeGreaterThan(160 + 100);
  // No two cards overlap: each is a 230 × 105 card until measured.
  for (const [index, one] of saved.nodes.entries())
    for (const other of saved.nodes.slice(index + 1))
      expect(
        Math.abs(one.position.x - other.position.x) >= 230 ||
          Math.abs(one.position.y - other.position.y) >= 105,
        `${one.label} and ${other.label} overlap`,
      ).toBe(true);
});

test("undo and redo step through graph edits by button and key, and a deleted card comes back", async ({
  page,
  request,
}) => {
  await open(page, request);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await expect(undo).toBeDisabled();
  await card(page, "yes").click();
  await page.keyboard.press("Delete");
  await expect(card(page, "yes")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(card(page, "yes")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  // Back at the saved draft, nothing is left to save.
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(card(page, "yes")).toHaveCount(0);
  await undo.click();
  await expect(card(page, "yes")).toHaveCount(1);
  await expect(redo).toBeEnabled();

  // A rename typed at once is one step; Undo restores the name before it.
  await card(page, "check").click();
  const name = page.getByLabel("Node name", { exact: true });
  await name.fill("Large order?");
  await expect(card(page, "check")).toContainText("Large order?");
  await undo.click();
  await expect(name).toHaveValue("Check");
  // A key typed in a field stays with the field.
  await name.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(name).toHaveValue("Chec");
  await expect(card(page, "check")).toHaveCount(1);
  // ⌘Z in a field undoes the field's typing, not the graph.
  await expect(redo).toBeDisabled();

  // A selected connection goes with Backspace and comes back with Undo.
  await page.locator('.react-flow__edge[data-id="b"]').click();
  await expect(
    page.getByRole("button", { name: "Delete connection", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await undo.click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("a published version offers no undo, add buttons or deletion by key", async ({
  page,
  request,
}) => {
  const complete: Definition = {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        id: "no",
        type: "OUTPUT",
        label: "No",
        expression: "0",
        position: { x: 200, y: 345 },
      },
    ],
    edges: [
      ...definition.edges,
      { id: "c", source: "check", target: "no", sourceHandle: "false" },
    ],
  };
  const rule = await createRule(request, {
    id: uniqueId("history-version"),
    definition: complete,
  });
  await publishRule(request, rule);
  await page.goto(`/#/rules/${rule.id}?version=1`);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".exit-add")).toHaveCount(0);
  await card(page, "no").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});
