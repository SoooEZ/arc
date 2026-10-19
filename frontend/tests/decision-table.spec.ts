import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Definition, DecisionTable, HitPolicy } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRule,
  readRule,
  uniqueId,
} from "./helpers/api";
import { canvasNode, nodeCard } from "./helpers/canvas";
import { editorLines, setEditorText } from "./helpers/editor";
import {
  installRenderProbe,
  renderCounts,
  resetRenderCounts,
  settledCommits,
} from "./helpers/renderProbe";

function shippingTable(hitPolicy: HitPolicy = "FIRST"): DecisionTable {
  return {
    hitPolicy,
    conditions: [
      { label: "Tier", expression: "tier" },
      { label: "Order amount", expression: "amount" },
      { label: "Region", expression: "region" },
    ],
    results: [{ name: "fee" }],
    rows: [
      { when: ['"gold"', "-", '"domestic"'], then: ["0"] },
      { when: ["-", ">= 100", '"domestic"'], then: ["0"] },
      { when: ["-", "< 100", '"domestic"'], then: ["$ROUND(amount * 0.1, 2)"] },
      { when: ["-", "-", '"overseas"'], then: ["25"] },
    ],
  };
}

function shipping(table: DecisionTable = shippingTable()): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "tier", type: "STRING", required: true, defaultValue: "silver" },
      { name: "amount", type: "NUMBER", required: true, defaultValue: 80 },
      {
        name: "region",
        type: "STRING",
        required: true,
        defaultValue: "domestic",
      },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "fee",
        type: "DECISION_TABLE",
        label: "Shipping fee",
        position: { x: 0, y: 180 },
        output: "shipping",
        table,
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Shipping",
        position: { x: 0, y: 360 },
        expression: "shipping",
      },
    ],
    edges: [
      { id: "in", source: "input", target: "fee", sourceHandle: "next" },
      { id: "result", source: "fee", target: "out", sourceHandle: "next" },
    ],
  };
}

async function openTable(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Edit table…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /decision table/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

const cell = (scope: Page | Locator, name: string) =>
  scope.getByRole("textbox", { name, exact: true });

/** Pastes text the way a spreadsheet's copy hands it to the focused cell. */
async function pasteInto(input: Locator, text: string) {
  await input.focus();
  await input.evaluate((element, data) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", data);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test("Add node offers a decision table that is complete once connected", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-add");
  await createRule(request, { id, definition: inputToOutput });
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Decision table", exact: true })
    .click();
  const card = page.locator(".graph-node.node-decision_table");
  await expect(card).toContainText("Decision table");
  await expect(card).toContainText("1 row → result_1");
  // It starts on the graph's first input, with a row that matches any value.
  await expect(
    page.getByRole("region", { name: "Table section" }).locator("thead"),
  ).toContainText("amount");
  await expect(page.getByLabel("Result variable", { exact: true })).toHaveValue(
    "result_1",
  );
  await expect(
    page.getByRole("region", { name: "Table check section" }),
  ).toContainText("Every row can match, and every value matches a row.");
  await expect(page.getByLabel("Matching", { exact: true })).toContainText(
    "First match",
  );
});

test("the grid quotes text, marks a cell that is no test and applies the table as one undoable edit", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-grid");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  const dialog = await openTable(page);
  const tier = cell(dialog, "Row 1 Tier");
  await tier.fill("platinum");
  await tier.press("Tab");
  await expect(tier).toHaveValue('"platinum"');
  const amount = cell(dialog, "Row 2 Order amount");
  await amount.fill(">= lots");
  await amount.press("Enter");
  // Enter commits and moves down the column.
  await expect(cell(dialog, "Row 3 Order amount")).toBeFocused();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(amount).toHaveAttribute(
    "title",
    "Comparisons and ranges take numbers.",
  );
  await expect(dialog).toContainText("1 cell to fix");
  // Cells draw every character of a comparison, never a ≥ ligature (F11).
  await expect(amount).toHaveCSS("font-variant-ligatures", "none");
  await amount.fill(">= 150");
  await amount.press("Tab");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await dialog.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(cell(dialog, "Row 5 Tier")).toHaveValue("-");
  const fee = cell(dialog, "Row 5 result fee");
  await fee.fill("30");
  await fee.press("Tab");
  // A row's menu moves it.
  await dialog
    .getByRole("button", { name: "Row 5 actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
  await expect(cell(dialog, "Row 4 result fee")).toHaveValue("30");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const preview = page
    .getByRole("region", { name: "Table section" })
    .locator(".decision-table-preview");
  await expect(preview).toContainText('"platinum"');
  await expect(nodeCard(page, "fee")).toContainText("5 rows → shipping");
  // One Undo step takes the whole table back.
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodeCard(page, "fee")).toContainText("4 rows → shipping");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await readRule(request, id)).draft.nodes.find(
    (node) => node.id === "fee",
  )?.table;
  expect(saved?.rows.map((row) => [...row.when, ...row.then])).toEqual([
    ['"platinum"', "-", '"domestic"', "0"],
    ["-", ">= 150", '"domestic"', "0"],
    ["-", "< 100", '"domestic"', "$ROUND(amount * 0.1, 2)"],
    ["-", "-", "-", "30"],
    ["-", "-", '"overseas"', "25"],
  ]);
});

test("a block pasted from a spreadsheet fills the grid from the focused cell and adds rows", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-paste");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  const dialog = await openTable(page);
  await pasteInto(
    cell(dialog, "Row 4 Tier"),
    'bronze\t>=50\t"domestic"\t5\r\nsilver\t\toverseas\tNext day\textra\r\n',
  );
  await expect(cell(dialog, "Row 4 Tier")).toHaveValue('"bronze"');
  await expect(cell(dialog, "Row 4 Order amount")).toHaveValue(">=50");
  await expect(cell(dialog, "Row 4 result fee")).toHaveValue("5");
  // An empty condition cell matches any value; result text is quoted.
  await expect(cell(dialog, "Row 5 Order amount")).toHaveValue("-");
  await expect(cell(dialog, "Row 5 Region")).toHaveValue('"overseas"');
  await expect(cell(dialog, "Row 5 result fee")).toHaveValue('"Next day"');
  await expect(dialog.getByRole("status")).toHaveText(
    "Pasted: 1 row added; 1 cell outside the table left out.",
  );
});

test("Escape asks before it drops staged edits; Cancel drops them; typing reverts with Escape", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-cancel");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  let dialog = await openTable(page);
  const tier = cell(dialog, "Row 1 Tier");
  await tier.fill("bronze");
  // Escape inside a cell takes back the typing and keeps the dialog.
  await tier.press("Escape");
  await expect(tier).toHaveValue('"gold"');
  await expect(dialog).toBeVisible();
  await tier.fill("bronze");
  await tier.press("Tab");
  page.once("dialog", (prompt) => void prompt.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  dialog = await openTable(page);
  await expect(cell(dialog, "Row 1 Tier")).toHaveValue('"gold"');
});

test("the table check names uncovered values, rows that never match and overlapping rows as the table changes", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-check");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  const check = page.getByRole("region", { name: "Table check section" });
  await expect(check).toContainText(
    'No row matches Region: not("domestic", "overseas"). Such a run fails.',
  );
  const dialog = await openTable(page);
  const panel = dialog.getByRole("region", { name: "Table check" });
  const region = cell(dialog, "Row 4 Region");
  await region.fill("-");
  await region.press("Tab");
  await expect(panel).toContainText(
    "Every row can match, and every value matches a row.",
  );
  await dialog.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(panel).toContainText(
    "Row 5 never matches: the rows above match every value it tests.",
  );
  await dialog.getByLabel("Matching", { exact: true }).click();
  await page
    .getByRole("option", { name: "Only one match", exact: true })
    .click();
  await expect(panel).toContainText(
    'Rows 1 and 2 can both match, for example Tier: "gold" · Order amount: 100 · Region: "domestic". With Only one match, such a run fails.',
  );
  // A cell that is no test pauses the check.
  const tier = cell(dialog, "Row 1 Tier");
  await tier.fill('"open');
  await tier.press("Tab");
  await expect(panel).toContainText("Fix the marked cells to check the table.");
  await dialog.getByLabel("Matching", { exact: true }).click();
  await page
    .getByRole("option", { name: "All matches (list)", exact: true })
    .click();
  await expect(panel).toContainText("With All matches");
});

test("a run names the row that matched, and a value no row matches fails with the server's message", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-run");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("tab", { name: "Input JSON", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("8.00");
  const step = page
    .locator(".trace-list button")
    .filter({ hasText: "Shipping fee" });
  await expect(step.locator(".trace-branch")).toHaveText("Row 3");
  await setEditorText(
    page,
    page.getByLabel("Test input JSON", { exact: true }),
    '{"tier": "silver", "amount": 80, "region": "moon"}',
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No row matches" }),
  ).toContainText('Region "moon"');
});

test("the code view writes the table row by row and builds it back", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-code");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const code = editorLines(page.getByLabel("ARC code editor", { exact: true }));
  await expect(code).toContainText('condition "Order amount" = amount;');
  await expect(code).toContainText(
    'row - | < 100 | "domestic" -> $ROUND(amount * 0.1, 2);',
  );
  await expect(code).toContainText("as shipping;");
  // The server reads its own text back to the same table.
  const draft = (await readRule(request, id)).draft;
  const rendered = await (
    await request.post("/api/studio/render", { data: draft })
  ).json();
  const built = await (
    await request.post("/api/studio/build", {
      data: { source: rendered.source },
    })
  ).json();
  expect(built.diagnostics).toEqual([]);
  expect(
    built.definition.nodes.find((node: { id: string }) => node.id === "fee")
      .table,
  ).toEqual(shippingTable());
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(canvasNode(page, "fee")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
});

test("renaming an input renames the table's condition and result expressions", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-rename");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=input`);
  const name = page.getByLabel("Parameter name", { exact: true }).nth(1);
  await expect(name).toHaveValue("amount");
  await name.fill("orderTotal");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const table = (await readRule(request, id)).draft.nodes.find(
    (node) => node.id === "fee",
  )?.table;
  expect(table?.conditions[1]).toEqual({
    label: "Order amount",
    expression: "orderTotal",
  });
  expect(table?.rows[2].then).toEqual(["$ROUND(orderTotal * 0.1, 2)"]);
  // Test cells hold literals, never names.
  expect(table?.rows[1].when).toEqual(["-", ">= 100", '"domestic"']);
});

test("a published version opens its table read-only", async ({
  page,
  request,
}) => {
  const id = uniqueId("table-version");
  const rule = await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await publishRule(request, rule);
  await page.goto(`/#/rules/${id}?version=1&node=fee`);
  await page.getByRole("button", { name: "View table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Decision table/ });
  await expect(cell(dialog, "Row 1 Tier")).toHaveAttribute("readonly", "");
  await expect(
    dialog.getByRole("button", { name: "Add row", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Apply to graph", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("on a phone the table fills the screen and its grid scrolls inside it", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = uniqueId("table-phone");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  const dialog = await openTable(page);
  await expect(dialog).toHaveClass(/MuiDialog-paperFullScreen/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const scroller = dialog.locator(".decision-table-scroll");
  expect(
    await scroller.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await cell(dialog, "Row 1 result fee").scrollIntoViewIfNeeded();
  await expect(cell(dialog, "Row 1 result fee")).toBeInViewport();
});

test("typing in one cell of a 200-row table leaves the other rows alone", async ({
  page,
  request,
}) => {
  await installRenderProbe(page);
  const table: DecisionTable = {
    ...shippingTable(),
    rows: Array.from({ length: 200 }, (_, index) => ({
      when: [`"tier${index}"`, `${index * 10}..<${index * 10 + 10}`, "-"],
      then: [`${index}`],
    })),
  };
  const id = uniqueId("table-render");
  await createRule(request, {
    id,
    kind: "DECISION_TREE",
    definition: shipping(table),
  });
  await page.goto(`/#/rules/${id}?node=fee`);
  const dialog = await openTable(page);
  const first = cell(dialog, "Row 1 result fee");
  await first.click();
  await first.press("End");
  await settledCommits(page);
  await resetRenderCounts(page);
  await page.keyboard.type("0123456789", { delay: 40 });
  await expect(first).toHaveValue("00123456789");
  expect((await renderCounts(page)).otherRowRenders).toBe(0);
  // Leaving the cell writes it: its own row renders (the focus has left it
  // as the edit commits), the 199 others do not.
  await settledCommits(page);
  await resetRenderCounts(page);
  await first.press("Tab");
  await settledCommits(page);
  expect((await renderCounts(page)).otherRowRenders).toBe(1);
});
