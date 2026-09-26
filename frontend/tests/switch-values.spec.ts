import { editorLines, setEditorText } from "./helpers/editor";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, InputType } from "../src/types";

async function select(
  page: Page,
  scope: Page | Locator,
  label: string,
  option: string | RegExp,
) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}

async function create(request: APIRequestContext, definition: Definition) {
  const id = `switch-values-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition },
  });
  expect(response.ok()).toBeTruthy();
  return id;
}

function matchingDefinition(type: InputType, value: unknown): Definition {
  return {
    schemaVersion: 1,
    inputs: [{ name: "value", type, required: true, defaultValue: value }],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose value",
        cases: [{ id: "one", label: "Match", expression: "true" }],
        position: { x: 200, y: 180 },
      },
      {
        id: "match",
        type: "OUTPUT",
        label: "Matched",
        expression: '"matched"',
        position: { x: 0, y: 400 },
      },
      {
        id: "fallback",
        type: "OUTPUT",
        label: "Fallback",
        expression: "-1",
        position: { x: 420, y: 400 },
      },
    ],
    edges: [
      { id: "start", source: "input", sourceHandle: "next", target: "choose" },
      {
        id: "one",
        source: "choose",
        sourceHandle: "case:one",
        target: "match",
      },
      {
        id: "default",
        source: "choose",
        sourceHandle: "default",
        target: "fallback",
      },
    ],
  };
}

for (const scenario of [
  { type: "BOOLEAN" as const, value: false, other: true, expression: "false" },
  { type: "NUMBER" as const, value: 0, other: 1, expression: "0" },
  {
    type: "STRING" as const,
    value: 'gold "雪" \\',
    other: "silver",
    expression: JSON.stringify('gold "雪" \\'),
  },
]) {
  test(`Switch matches a typed ${scenario.type} case and edits Default through its Output`, async ({
    page,
    request,
  }) => {
    const id = await create(
      request,
      matchingDefinition(scenario.type, scenario.value),
    );
    await page.goto(`/#/rules/${id}?node=choose`);
    await select(page, page, "Switch mode", "Match a value");
    await select(
      page,
      page,
      "Value to match · value source",
      "Upstream variable",
    );
    await select(
      page,
      page,
      "Value to match",
      `value (${scenario.type.toLowerCase()}) - Inputs`,
    );
    const option = page.getByTestId("switch-case-one");
    await select(page, option, "Constant type", scenario.type.toLowerCase());
    if (scenario.type === "BOOLEAN")
      await select(page, option, "Case 1 value", "false");
    else
      await option
        .getByLabel("Case 1 value", { exact: true })
        .fill(String(scenario.value));
    const fallback = page.getByTestId("switch-default-return");
    await select(page, fallback, "Constant type", "string");
    await fallback
      .getByLabel("Default return value", { exact: true })
      .fill("No match");
    await page.getByRole("button", { name: "Test rule", exact: true }).click();
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText('"matched"');
    await setEditorText(
      page,
      page.getByLabel("Test input JSON", { exact: true }),
      JSON.stringify({ value: scenario.other }),
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText('"No match"');
    await page
      .getByRole("button", { name: "Close test panel", exact: true })
      .click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = (await (await request.get(`/api/rules/${id}`)).json())
      .draft as Definition;
    const node = saved.nodes.find((item) => item.id === "choose")!;
    expect(node.selector).toBe("value");
    expect(node.cases?.[0].expression).toBe(scenario.expression);
    expect(saved.nodes.find((item) => item.id === "fallback")?.expression).toBe(
      '"No match"',
    );
    await page
      .getByRole("button", { name: "Code editor", exact: true })
      .click();
    await expect(
      editorLines(page.getByLabel("ARC code editor", { exact: true })),
    ).toContainText("select value;");
    await expect(
      editorLines(page.getByLabel("ARC code editor", { exact: true })),
    ).toContainText("equals");
    await page.getByRole("button", { name: "Graph view", exact: true }).click();
    await page.reload();
    await page
      .locator('.react-flow__node[data-id="choose"] .graph-node')
      .click();
    await expect(
      page.getByRole("combobox", { name: "Switch mode", exact: true }),
    ).toHaveText("Match a value");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByText("Version 1 published and ready to call"),
    ).toBeVisible();
    const result = await (
      await request.post(`/api/rules/${id}/execute`, {
        data: { version: 1, inputs: { value: scenario.value } },
      })
    ).json();
    expect(result.result).toBe("matched");
  });
}

test("range cases and a staged Default return survive cancel, apply, code round trips and publication", async ({
  page,
  request,
}) => {
  const definition = matchingDefinition("NUMBER", 25);
  definition.inputs[0].name = "amount";
  const choose = definition.nodes.find((node) => node.id === "choose")!;
  choose.cases = [
    { id: "low", label: "Below 50", expression: "amount < 50" },
    { id: "mid", label: "Below 100", expression: "amount < 100" },
  ];
  definition.nodes.find((node) => node.id === "match")!.expression = "1";
  definition.nodes.find((node) => node.id === "fallback")!.expression = "2";
  definition.edges[1].sourceHandle = "case:low";
  definition.edges[2].sourceHandle = "case:mid";
  const id = await create(request, definition);
  await page.goto(`/#/rules/${id}?node=choose`);
  const open = async () => {
    await page
      .locator('.react-flow__node[data-id="choose"] .graph-node')
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Edit node/ });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  let dialog = await open();
  await dialog
    .getByRole("button", { name: "Add default return", exact: true })
    .click();
  await dialog.getByLabel("Default return value", { exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  dialog = await open();
  await dialog
    .getByRole("button", { name: "Add default return", exact: true })
    .click();
  await dialog.getByLabel("Default return value", { exact: true }).fill("3");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(
    editorLines(page.getByLabel("ARC code editor", { exact: true })),
  ).toContainText("return 3;");
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  for (const [amount, expected] of [
    [-1, 1],
    [49.999, 1],
    [50, 2],
    [99.999, 2],
    [100, 3],
    [200, 3],
  ]) {
    const response = await request.post(`/api/rules/${id}/execute`, {
      data: { version: 1, inputs: { amount } },
    });
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).result).toBe(expected);
  }
});
