import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const colors = {
  function: "rgb(139, 104, 47)",
  input: "rgb(32, 95, 166)",
  result: "rgb(123, 63, 152)",
  local: "rgb(82, 102, 93)",
  string: "rgb(39, 123, 97)",
  comment: "rgb(140, 151, 146)",
};

function definition(connected = true): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 25 },
      {
        name: "customer",
        type: "OBJECT",
        required: true,
        defaultValue: { amount: 10, rows: [{ price: 2 }] },
      },
      { name: "items", type: "ARRAY", required: true, defaultValue: [1, 2] },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression: "amount * 2",
        output: "price",
        position: { x: 300, y: 160 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose amount",
        cases: [
          {
            id: "one",
            label: "One",
            expression: "$ROUND(amount, 2) + price > customer.amount",
          },
          {
            id: "two",
            label: "Two",
            expression: "$SUM($MAP(items, amount, amount + price)) > 0",
          },
        ],
        position: { x: 300, y: 320 },
      },
      ...["one", "two", "other"].map((id, index) => ({
        id,
        type: "OUTPUT" as const,
        label: `${id} result`,
        expression: String(index + 1),
        position: { x: index * 300, y: 500 },
      })),
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "calc" },
      ...(connected
        ? [
            {
              id: "calculated",
              source: "calc",
              sourceHandle: "next",
              target: "choose",
            },
          ]
        : []),
      { id: "one", source: "choose", sourceHandle: "case:one", target: "one" },
      { id: "two", source: "choose", sourceHandle: "case:two", target: "two" },
      {
        id: "other",
        source: "choose",
        sourceHandle: "default",
        target: "other",
      },
    ],
  };
}

async function create(request: APIRequestContext, connected = true) {
  const id = `expression-colors-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const draft = definition(connected);
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition: draft },
  });
  expect(response.status()).toBe(201);
  const variables = await request.post("/api/variables", { data: draft });
  expect(variables.ok()).toBeTruthy();
  expect((await variables.json()).choose).toEqual(
    connected ? ["amount", "customer", "items", "price"] : [],
  );
  return id;
}

// Read the actual painted characters, independent of Monaco's generated mtk
// class names and whether adjacent tokens happen to share one rendered span.
async function paintedColors(input: Locator, fragment: string, occurrence = 0) {
  return editorLines(input).evaluate(
    (lines, { fragment, occurrence }) => {
      let text = "";
      const foregrounds: string[] = [];
      for (const line of lines.querySelectorAll(".view-line")) {
        if (text) {
          text += "\n";
          foregrounds.push("");
        }
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const content = (node.textContent ?? "").replace(/\u00a0/g, " ");
          const color = getComputedStyle(node.parentElement!).color;
          text += content;
          foregrounds.push(...Array<string>(content.length).fill(color));
          node = walker.nextNode();
        }
      }
      let start = -1;
      for (let index = 0; index <= occurrence; index++) {
        start = text.indexOf(fragment, start + 1);
        if (start < 0) return [];
      }
      return foregrounds.slice(start, start + fragment.length);
    },
    { fragment, occurrence },
  );
}

async function expectColor(
  input: Locator,
  fragment: string,
  color: string,
  occurrence = 0,
) {
  await expect
    .poll(() => paintedColors(input, fragment, occurrence))
    .toEqual(Array<string>(fragment.length).fill(color));
}

async function expectUnclassified(
  input: Locator,
  fragment: string,
  occurrence = 0,
) {
  await expect
    .poll(async () => {
      const actual = await paintedColors(input, fragment, occurrence);
      return (
        actual.length === fragment.length &&
        actual.every(
          (color) => color !== colors.input && color !== colors.result,
        )
      );
    })
    .toBe(true);
}

async function focusNode(page: Page, name: string) {
  if (!(await page.locator(".node-outline").isVisible()))
    await page
      .getByRole("button", { name: "Node outline", exact: true })
      .click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}

test("expression colors distinguish functions, input roots, results and shadowing locals across models", async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/#/rules/${id}?node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  const second = page.getByLabel("Case 2 condition", { exact: true });
  await expectColor(first, "$ROUND", colors.function);
  await expectColor(first, "amount", colors.input);
  await expectColor(first, "customer", colors.input);
  await expectColor(first, "price", colors.result);
  await expectUnclassified(first, "amount", 1);
  await expectColor(second, "$SUM", colors.function);
  await expectColor(second, "$MAP", colors.function);
  await expectColor(second, "items", colors.input);
  await expectColor(second, "amount", colors.local);
  await expectColor(second, "amount", colors.local, 1);
  await expectColor(second, "price", colors.result);

  await page
    .getByRole("button", { name: "Move case 2 up", exact: true })
    .click();
  await expectColor(first, "amount", colors.local);
  await expectColor(second, "amount", colors.input);
  await expectColor(second, "price", colors.result);
  await setEditorText(page, second, "$ROUND(amount, 2) + price > 0");
  await expectColor(first, "amount", colors.local, 1);
  await expectColor(second, "amount", colors.input);
  await expectColor(second, "price", colors.result);

  await focusNode(page, "Calculate price");
  const formula = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, formula, "amount + price");
  await expectColor(formula, "amount", colors.input);
  // A formula cannot read its own output; previously mounted Switch providers
  // must not color it as an available upstream result in this new model.
  await expectUnclassified(formula, "price");
  await focusNode(page, "Choose amount");
  await expectColor(second, "price", colors.result);
  await expectColor(first, "amount", colors.local, 1);
  await page.screenshot({
    path: test.info().outputPath("expression-colors.png"),
  });
});

test("expanded expression colors leave string, comment and property text unclassified", async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/#/rules/${id}?node=choose`);
  await page
    .getByRole("button", {
      name: "Functions & editor · Case 1 condition",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Case 1 condition",
    exact: true,
  });
  const expression = dialog.getByLabel("Expression code editor", {
    exact: true,
  });
  await setEditorText(
    page,
    expression,
    '$OBJECT("amount price $ROUND", customer.amount,\n"nested", customer.rows.0.price,\n"total", amount + price)\n// amount price $ROUND customer.amount',
  );
  await expectColor(expression, "$OBJECT", colors.function);
  await expectColor(expression, '"amount price $ROUND"', colors.string);
  await expectColor(expression, "customer", colors.input);
  await expectUnclassified(expression, "amount", 1);
  await expectColor(expression, "customer", colors.input, 1);
  await expectUnclassified(expression, "price", 1);
  await expectColor(expression, "amount", colors.input, 2);
  await expectColor(expression, "price", colors.result, 2);
  await expectColor(
    expression,
    "// amount price $ROUND customer.amount",
    colors.comment,
  );
  await page.screenshot({
    path: test.info().outputPath("expression-colors-expanded.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectColor(
    page.getByLabel("Case 1 condition", { exact: true }),
    "amount",
    colors.input,
  );
});

test("disconnected expression scopes do not inherit input or result colors from another selected node", async ({
  page,
  request,
}) => {
  const id = await create(request, false);
  await page.goto(`/#/rules/${id}?node=calc`);
  const formula = page.getByLabel("Expression", { exact: true });
  await expectColor(formula, "amount", colors.input);
  await focusNode(page, "Choose amount");
  const first = page.getByLabel("Case 1 condition", { exact: true });
  await expectColor(first, "$ROUND", colors.function);
  await expectUnclassified(first, "amount");
  await expectUnclassified(first, "customer");
  await expectUnclassified(first, "price");
  await expect(editorLines(first)).toHaveText(
    "$ROUND(amount, 2) + price > customer.amount",
  );
  await focusNode(page, "Calculate price");
  await expectColor(formula, "amount", colors.input);
});
