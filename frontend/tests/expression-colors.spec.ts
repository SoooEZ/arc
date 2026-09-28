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
  keyword: "rgb(135, 82, 149)",
  type: "rgb(50, 121, 102)",
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
      name: "Open in Editor · Case 1 condition",
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

test("an Output field alias does not color its same-named input as a computed result in Script", async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/#/studio/${id}`);
  const editor = page.getByLabel("ARC code editor", { exact: true });
  await setEditorText(
    page,
    editor,
    `schema 1;
inputs { total: NUMBER required; }
node input INPUT "Inputs" { next -> out; }
node out OUTPUT "Result" { return total; as total; }`,
  );
  await expectColor(editor, "total", colors.input);
  await expectColor(editor, "total", colors.input, 1);
  await expectUnclassified(editor, "total", 2);
});

test("dotted paths take no keyword, type or constant color while standalone words keep theirs", async ({
  page,
  request,
}) => {
  const id = `expression-colors-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const paths =
    "customer.format + customer.lowercase + customer.reuse + customer.isnull + customer.ACCOUNT_NUMBER + customer.wallet + customer.plain == null";
  // The inline editor renders only its visible lines, so it gets a short expression.
  const shortPaths = "customer.plain + customer.wallet + customer.isnull";
  const draft = definition(true);
  draft.nodes = draft.nodes.map((node) =>
    node.id === "choose"
      ? {
          ...node,
          cases: [
            { ...node.cases![0], expression: paths },
            { ...node.cases![1], expression: shortPaths },
          ],
        }
      : node,
  );
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition: draft },
  });
  expect(created.status()).toBe(201);
  const properties = [
    "format",
    "lowercase",
    "reuse",
    "isnull",
    "ACCOUNT_NUMBER",
    "wallet",
  ];
  // Monarch painted the "at" of format, the "case" of lowercase, the "use" of reuse, the
  // "null" of isnull, the "NUMBER" of ACCOUNT_NUMBER and the "let" of wallet.
  const expectPlainProperties = async (
    editor: Locator,
    checked: string[] = properties,
  ) => {
    await expectColor(editor, "customer", colors.input);
    const plain = await paintedColors(editor, "plain");
    expect(plain).toHaveLength("plain".length);
    for (const property of checked)
      await expect
        .poll(() => paintedColors(editor, property), property)
        .toEqual(Array<string>(property.length).fill(plain[0]));
    return plain[0];
  };
  // The inline inspector editor first: a node request applies when the editor opens.
  await page.goto(`/#/rules/${id}?node=choose`);
  await expectPlainProperties(
    page.getByLabel("Case 2 condition", { exact: true }),
    ["wallet", "isnull"],
  );
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const script = page.getByLabel("ARC code editor", { exact: true });
  await expect(editorLines(script)).toContainText("customer.wallet");
  const plain = await expectPlainProperties(script);
  await expectColor(script, "let", colors.keyword);
  await expectColor(script, "case", colors.keyword);
  await expectColor(script, "NUMBER", colors.type);
  // The standalone null after "==" is the second "null" of the script (isnull holds the first).
  await expect
    .poll(() => paintedColors(script, "null", 1))
    .not.toEqual(Array<string>("null".length).fill(plain));
});

test("the color key, the variables list and the editor paint each symbol role from one token", async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/#/rules/${id}?node=choose`);
  const first = page.getByLabel("Case 1 condition", { exact: true });
  const painted = async (fragment: string) =>
    (await paintedColors(first, fragment))[0];
  const computed = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).color);
  // The roles are painted once the scope has loaded; compare only then.
  await expectColor(first, "$ROUND", colors.function);
  await expectColor(first, "amount", colors.input);
  await expectColor(first, "price", colors.result);
  await page
    .getByRole("button", {
      name: "Available variables · Case 1 condition",
      exact: true,
    })
    .click();
  const list = page.getByRole("dialog", {
    name: "Available variables · Case 1 condition",
    exact: true,
  });
  expect(await computed(list.locator('code[data-kind="input"]').first())).toBe(
    await painted("amount"),
  );
  expect(await computed(list.locator('code[data-kind="result"]').first())).toBe(
    await painted("price"),
  );
  await list
    .getByRole("button", { name: "Close available variables", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const key = page.locator(".expression-color-key");
  await expect(key).toBeVisible();
  expect(await computed(key.locator('[data-role="function"]'))).toBe(
    await painted("$ROUND"),
  );
  expect(await computed(key.locator('[data-role="parameter"]'))).toBe(
    await painted("amount"),
  );
  expect(await computed(key.locator('[data-role="result"]'))).toBe(
    await painted("price"),
  );
  // The formula role has no painted symbol here: its key entry reads the token itself.
  const formulaToken = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-symbol-formula)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await computed(key.locator('[data-role="formula"]'))).toBe(
    formulaToken,
  );
});
