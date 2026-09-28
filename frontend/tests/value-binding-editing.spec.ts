import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, Rule, RuleNode } from "../src/types";
import { editorLines } from "./helpers/editor";
import { createRule, publishRule, uniqueId } from "./helpers/api";

const node = (
  id: string,
  type: RuleNode["type"],
  fields: Partial<RuleNode> = {},
  y = 0,
): RuleNode => ({
  id,
  type,
  label: id,
  position: { x: 250, y },
  ...fields,
});
const edge = (source: string, target: string, sourceHandle = "next") => ({
  id: `${source}-${target}-${sourceHandle}`,
  source,
  target,
  sourceHandle,
});
const amount = {
  name: "amount",
  type: "NUMBER" as const,
  required: true,
  defaultValue: 10,
};

async function create(
  request: APIRequestContext,
  definition: Definition,
  prefix = "binding-edit",
) {
  const id = uniqueId(`${prefix}`);
  const response = await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  return response;
}

async function select(scope: Page | Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

async function savedNode(
  request: APIRequestContext,
  id: string,
  nodeId: string,
) {
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  return saved.draft.nodes.find((item) => item.id === nodeId)!;
}

function outputRule(expression: string): Definition {
  return {
    schemaVersion: 1,
    inputs: [amount],
    nodes: [
      node("input", "INPUT"),
      node(
        "calc",
        "FORMULA",
        { label: "Calculate", expression: "amount * 2", output: "total" },
        170,
      ),
      node("out", "OUTPUT", { label: "Return", expression }, 340),
    ],
    edges: [edge("input", "calc"), edge("calc", "out")],
  };
}

test("an inferred number constant keeps its field while cleared or negated, until the value changes elsewhere", async ({
  page,
  request,
}) => {
  const rule = await create(request, outputRule("0"));
  await page.goto(`/#/rules/${rule.id}?node=out`);
  const inspector = page.locator(".inspector-sidebar");
  const source = inspector.getByRole("combobox", {
    name: "Return value · value source",
    exact: true,
  });
  const field = inspector.getByLabel("Return value", { exact: true });
  await expect(source).toHaveText("Constant");
  await expect(field).toHaveValue("0");
  await field.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(source).toHaveText("Constant");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  // A number input reports "" for a lone minus sign.
  await page.keyboard.type("-");
  await expect(source).toHaveText("Constant");
  await expect(field).toBeFocused();
  await page.keyboard.type("5");
  await expect(field).toHaveValue("-5");
  await expect(inspector.getByLabel("Return value preview")).toContainText(
    "-5",
  );
  await save(page);
  expect((await savedNode(request, rule.id, "out")).expression).toBe("-5");

  // A change applied from the node editor is not this control's edit: the
  // sidebar shows the control that fits the new value.
  await page
    .locator('.react-flow__node[data-id="out"] .graph-node')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit node · Return",
    exact: true,
  });
  await select(dialog, "Return value · value source", "Upstream variable");
  await select(dialog, "Return value", "total [result] from Calculate");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(source).toHaveText("Upstream variable");
  await expect(
    inspector.getByRole("combobox", { name: "Return value", exact: true }),
  ).toContainText("total");
  await save(page);
  expect((await savedNode(request, rule.id, "out")).expression).toBe("total");
});

test("a Switch value case keeps its constant field while the user retypes a negative number", async ({
  page,
  request,
}) => {
  const rule = await create(request, {
    schemaVersion: 1,
    inputs: [amount],
    nodes: [
      node("input", "INPUT"),
      node(
        "choose",
        "SWITCH",
        {
          label: "Choose",
          selector: "amount",
          cases: [{ id: "big", label: "Big", expression: "100" }],
        },
        170,
      ),
      node("yes", "OUTPUT", { expression: "1" }, 340),
      node("no", "OUTPUT", { expression: "0" }, 340),
    ],
    edges: [
      edge("input", "choose"),
      edge("choose", "yes", "case:big"),
      edge("choose", "no", "default"),
    ],
  });
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const card = page.getByTestId("switch-case-big");
  const source = card.getByRole("combobox", {
    name: "Case 1 value · value source",
    exact: true,
  });
  const field = card.getByLabel("Case 1 value", { exact: true });
  await expect(source).toHaveText("Constant");
  await expect(field).toHaveValue("100");
  await field.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("-");
  await expect(source).toHaveText("Constant");
  await expect(field).toBeFocused();
  await page.keyboard.type("7");
  await expect(field).toHaveValue("-7");
  await save(page);
  expect((await savedNode(request, rule.id, "choose")).cases).toEqual([
    { id: "big", label: "Big", expression: "-7" },
  ]);
});

test("an array constant keeps its text field and reports the unfinished literal while typing", async ({
  page,
  request,
}) => {
  const rule = await create(request, outputRule("[1, 2]"));
  await page.goto(`/#/rules/${rule.id}?node=out`);
  const inspector = page.locator(".inspector-sidebar");
  const source = inspector.getByRole("combobox", {
    name: "Return value · value source",
    exact: true,
  });
  const field = inspector.getByLabel("Return value", { exact: true });
  await expect(source).toHaveText("Constant");
  await expect(
    inspector.getByRole("combobox", { name: "Constant type", exact: true }),
  ).toHaveText("array");
  await field.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(",");
  await expect(field).toHaveValue("[1, 2,]");
  await expect(source).toHaveText("Constant");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(
    inspector.getByText('Enter an array literal such as [1, "two", true].'),
  ).toBeVisible();
  await page.keyboard.type(" 3");
  await expect(field).toHaveValue("[1, 2, 3]");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await save(page);
  expect((await savedNode(request, rule.id, "out")).expression).toBe(
    "[1, 2, 3]",
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("[1,2,3]");
});

test("literals the server rejects open as expressions, and a typed one is reported in the number field", async ({
  page,
  request,
}) => {
  const stored = [".5e3", "1.", '"a\\\nb"'];
  const rule = await create(request, {
    schemaVersion: 1,
    inputs: [amount],
    nodes: [
      node("input", "INPUT"),
      ...stored.map((expression, index) =>
        node(`out${index}`, "OUTPUT", { expression }, 170 + 170 * index),
      ),
      node("padded", "OUTPUT", { expression: " 12 " }, 680),
    ],
    edges: [
      ...stored.map((_, index) => edge("input", `out${index}`)),
      edge("input", "padded"),
    ],
  });
  await page.goto(`/#/rules/${rule.id}?node=out0`);
  const inspector = page.locator(".inspector-sidebar");
  for (const [index, expression] of stored.entries()) {
    await page
      .locator(`.react-flow__node[data-id="out${index}"] .graph-node`)
      .click();
    await expect(
      inspector.getByRole("combobox", {
        name: "Return value · value source",
        exact: true,
      }),
    ).toHaveText("Expression");
    await expect(
      editorLines(inspector.getByLabel("Return value", { exact: true })),
    ).toHaveText(expression.split("\n").join(""));
  }
  await select(inspector, "Return value · value source", "Constant");
  await select(inspector, "Constant type", "number");
  const field = inspector.getByLabel("Return value", { exact: true });
  await field.fill(".5e3");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(
    inspector.getByText("Enter a number such as 42, -0.5 or 1e3."),
  ).toBeVisible();
  await field.fill("500");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await save(page);
  expect((await savedNode(request, rule.id, "out2")).expression).toBe("500");
  // The server trims padding, so a padded number is a constant with its digits shown.
  await page.locator('.react-flow__node[data-id="padded"] .graph-node').click();
  await expect(
    inspector.getByRole("combobox", {
      name: "Return value · value source",
      exact: true,
    }),
  ).toHaveText("Constant");
  await expect(field).toHaveValue("12");
});

test("Reference parameters named like Object.prototype members show, bind and run", async ({
  page,
  request,
}) => {
  const names = [
    "constructor",
    "toString",
    "valueOf",
    "__proto__",
    "hasOwnProperty",
  ];
  const child = await create(
    request,
    {
      schemaVersion: 1,
      inputs: names.map((name) => ({
        name,
        type: "NUMBER",
        required: false,
        defaultValue: 100,
      })),
      nodes: [
        node("input", "INPUT"),
        node("sum", "OUTPUT", { expression: names.join(" + ") }, 170),
      ],
      edges: [edge("input", "sum")],
    },
    "prototype-child",
  );
  await publishRule(request, child);
  const parent = await create(request, {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node(
        "reuse",
        "REFERENCE",
        {
          label: "Reuse",
          ruleId: child.id,
          version: 1,
          bindings: {},
          output: "result",
        },
        170,
      ),
      node("out", "OUTPUT", { expression: "result" }, 340),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/#/rules/${parent.id}?node=reuse`);
  const inspector = page.locator(".inspector-sidebar");
  for (const name of names)
    await expect(
      inspector.getByRole("combobox", {
        name: `${name} · value source`,
        exact: true,
      }),
    ).toHaveText("Upstream variable");
  for (const [index, name] of names.entries()) {
    await select(inspector, `${name} · value source`, "Constant");
    await inspector.getByLabel(name, { exact: true }).fill(String(index + 1));
  }
  await save(page);
  const bindings = (await savedNode(request, parent.id, "reuse")).bindings!;
  expect(Object.entries(bindings).sort()).toEqual(
    names.map((name, index) => [name, String(index + 1)]).sort(),
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("15");
  await select(inspector, "__proto__ · value source", "Use default / omit");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("111");
  expect(errors).toEqual([]);
});

test("an ARRAY constant refuses a list the server's tokenizer cannot read", async ({
  page,
  request,
}) => {
  const child = await create(
    request,
    {
      schemaVersion: 1,
      inputs: [
        { name: "items", type: "ARRAY", required: false, defaultValue: [] },
      ],
      nodes: [
        node("input", "INPUT"),
        node("sum", "OUTPUT", { expression: "$SUM(items)" }, 170),
      ],
      edges: [edge("input", "sum")],
    },
    "array-child",
  );
  await publishRule(request, child);
  const parent = await create(request, {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node(
        "reuse",
        "REFERENCE",
        {
          label: "Reuse",
          ruleId: child.id,
          version: 1,
          bindings: {},
          output: "result",
        },
        170,
      ),
      node("out", "OUTPUT", { expression: "result" }, 340),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  });
  await page.goto(`/#/rules/${parent.id}?node=reuse`);
  const inspector = page.locator(".inspector-sidebar");
  await select(inspector, "items · value source", "Constant");
  const field = inspector.getByLabel("items", { exact: true });
  const list = (count: number) =>
    `[${Array.from({ length: count }, (_, index) => index).join(",")}]`;
  // 128 numbers are 257 tokens: the field offered the list, and validation failed later.
  await field.fill(list(128));
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(
    inspector.getByText(/Array literals are limited to 256 tokens/),
  ).toBeVisible();
  await field.fill(list(127));
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await save(page);
  expect((await savedNode(request, parent.id, "reuse")).bindings).toEqual({
    items: list(127),
  });
});

test("a Reference mapping for a parameter the pinned version does not declare is named and removable", async ({
  page,
  request,
}) => {
  const child = await create(
    request,
    {
      schemaVersion: 1,
      inputs: [{ name: "a", type: "NUMBER", required: false, defaultValue: 1 }],
      nodes: [
        node("input", "INPUT"),
        node("sum", "OUTPUT", { expression: "a + 1" }, 170),
      ],
      edges: [edge("input", "sum")],
    },
    "undeclared-child",
  );
  await publishRule(request, child);
  const parent = await create(request, {
    schemaVersion: 1,
    inputs: [amount],
    nodes: [
      node("input", "INPUT"),
      node(
        "reuse",
        "REFERENCE",
        {
          label: "Reuse",
          ruleId: child.id,
          version: 1,
          // "ghost" was mapped for another pin; the cards show declared parameters only.
          bindings: { a: "amount", ghost: "1" },
          output: "result",
        },
        170,
      ),
      node("out", "OUTPUT", { expression: "result" }, 340),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  });
  await page.goto(`/#/rules/${parent.id}?node=reuse`);
  const nodeErrors = page.getByRole("button", { name: /^Node errors/ });
  await expect(nodeErrors).toBeVisible();
  const alert = page.getByRole("alert").filter({ hasText: "Also maps ghost" });
  await expect(alert).toContainText(
    `version 1 of ${child.id} does not declare`,
  );
  await alert.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await save(page);
  await expect(nodeErrors).toHaveCount(0);
  expect((await savedNode(request, parent.id, "reuse")).bindings).toEqual({
    a: "amount",
  });
});

test("Transform field editors keep their mode and partial text across additions and removals", async ({
  page,
  request,
}) => {
  const rule = await create(request, {
    schemaVersion: 1,
    inputs: [amount],
    nodes: [
      node("input", "INPUT"),
      node(
        "shape",
        "TRANSFORM",
        {
          label: "Shape",
          fields: [
            { name: "a", expression: "amount" },
            { name: "b", expression: "5" },
          ],
          output: "shaped",
        },
        170,
      ),
      node("out", "OUTPUT", { expression: "shaped" }, 340),
    ],
    edges: [edge("input", "shape"), edge("shape", "out")],
  });
  await page.goto(`/#/rules/${rule.id}?node=shape`);
  const inspector = page.locator(".inspector-sidebar");
  const source = (index: number) =>
    inspector.getByRole("combobox", {
      name: `Field ${index} value · value source`,
      exact: true,
    });
  await select(inspector, "Field 1 value · value source", "Expression");
  await expect(source(1)).toHaveText("Expression");
  const second = inspector.getByLabel("Field 2 value", { exact: true });
  await expect(source(2)).toHaveText("Constant");
  await second.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("-");
  // Adding a field remounted every row's editor: Field 1 fell back to the
  // variable picker and Field 2 lost its unfinished number.
  await inspector
    .getByRole("button", { name: "Add field", exact: true })
    .click();
  await expect(
    inspector.getByLabel("Field 3 name", { exact: true }),
  ).toHaveValue("field_3");
  await expect(source(1)).toHaveText("Expression");
  await expect(source(2)).toHaveText("Constant");
  await second.click();
  await page.keyboard.press("End");
  await page.keyboard.type("5");
  await expect(second).toHaveValue("-5");
  await inspector
    .getByRole("button", { name: "Remove field 3", exact: true })
    .click();
  await expect(source(1)).toHaveText("Expression");
  await expect(second).toHaveValue("-5");
  // Removing the first field moves the second row up with its editor state.
  await inspector
    .getByRole("button", { name: "Remove field 1", exact: true })
    .click();
  await expect(
    inspector.getByLabel("Field 1 name", { exact: true }),
  ).toHaveValue("b");
  await expect(source(1)).toHaveText("Constant");
  await expect(
    inspector.getByLabel("Field 1 value", { exact: true }),
  ).toHaveValue("-5");
  await save(page);
  expect((await savedNode(request, rule.id, "shape")).fields).toEqual([
    { name: "b", expression: "-5" },
  ]);
});
