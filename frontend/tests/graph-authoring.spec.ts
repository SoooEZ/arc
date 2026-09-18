import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";
import type { Definition } from "../src/types";

async function create(request: APIRequestContext, source: string) {
  const built = await (
    await request.post("/api/studio/build", { data: { source } })
  ).json();
  expect(built.diagnostics).toEqual([]);
  const id = `graph-authoring-${Date.now()}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition: built.definition },
  });
  expect(response.ok()).toBeTruthy();
  return id;
}
async function replaceExpression(page: Page, dialog: Locator, source: string) {
  await dialog.locator(".monaco-editor").click({ position: { x: 130, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
}
async function save(
  page: Page,
  request: APIRequestContext,
  id: string,
): Promise<Definition> {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  return (await (await request.get(`/api/rules/${id}`)).json()).draft;
}
async function focusNode(page: Page, label: string) {
  const outline = page.locator(".node-outline");
  if (!(await outline.isVisible()))
    await page
      .getByRole("button", { name: "Node outline", exact: true })
      .click();
  await outline.getByRole("button", { name: new RegExp(label) }).click();
}

test("Graph condition and formula editors expose functions, insertion, validation and cancellation", async ({
  page,
  request,
}) => {
  const id = await create(
    request,
    `
    inputs { amount: NUMBER required default 120; items: ARRAY required default [10, 20]; }
    node input INPUT "Inputs" at (250, 0) { next -> condition; }
    node condition CONDITION "Eligibility" at (250, 160) { when amount >= 100; true -> formula; false -> fallback; }
    node formula FORMULA "Calculation" at (50, 340) { let total = 1; next -> out; }
    node out OUTPUT "Output" at (50, 520) { return total; }
    node fallback OUTPUT "Fallback" at (450, 340) { return 0; }
  `,
  );
  await page.goto(`/#/rules/${id}`);
  await page
    .getByRole("button", {
      name: "Functions & editor · Condition",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /Expression editor/ });
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  await dialog.getByPlaceholder("Search functions…").fill("SUM");
  const sum = dialog
    .locator(".function-chips")
    .getByRole("button", { name: "SUM", exact: true });
  await sum.hover();
  await expect(page.getByRole("tooltip")).toContainText("Aggregates");
  await replaceExpression(page, dialog, " ");
  await page.keyboard.press("ControlOrMeta+a");
  await sum.click();
  await expect(dialog.locator(".view-lines")).toContainText("SUM(values)");
  await replaceExpression(page, dialog, "SUM(items) >= 20");
  await expect(
    dialog.getByRole("button", { name: "Apply expression" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply expression" }).click();
  await expect(page.getByLabel("When", { exact: true })).toHaveValue(
    "SUM(items)",
  );
  await focusNode(page, "Calculation");
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  await replaceExpression(
    page,
    dialog,
    "SUM(MAP(items, item, ROUND(item * 1.25, 2)))",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply expression" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply expression" }).click();
  await expect(page.getByLabel("Expression", { exact: true })).toHaveValue(
    "SUM(MAP(items, item, ROUND(item * 1.25, 2)))",
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("37.5");
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  await replaceExpression(page, dialog, "missing + 1");
  await expect(dialog.getByRole("alert")).toContainText(
    "Unavailable variables: missing",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply expression" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Expression", { exact: true })).toHaveValue(
    "SUM(MAP(items, item, ROUND(item * 1.25, 2)))",
  );
  await save(page, request, id);
});

test("Switch and Transform survive Graph/code edits, case reordering and versioned execution", async ({
  page,
  request,
}) => {
  const id = await create(
    request,
    `
    inputs { customer: OBJECT required default {"name":"  Ada  ","amount":"150"}; }
    node input INPUT "Inputs" at (350, 0) { next -> transform; }
    node transform TRANSFORM "Normalize customer" at (350, 160) {
      field "name" = UPPER(TRIM(customer.name));
      field "amount" = TO_NUMBER(customer.amount);
      as normalized; next -> choose;
    }
    node choose SWITCH "Pricing tier" at (350, 340) {
      case premium "Premium" when normalized.amount >= 100;
      case standard "Standard" when normalized.amount >= 50;
      case:premium -> premium; case:standard -> standard; default -> fallback;
    }
    node premium OUTPUT "Premium result" at (50, 520) { return OBJECT("tier", "premium", "data", normalized); }
    node standard OUTPUT "Standard result" at (350, 520) { return OBJECT("tier", "standard", "data", normalized); }
    node fallback OUTPUT "Fallback result" at (650, 520) { return OBJECT("tier", "fallback", "data", normalized); }
  `,
  );
  await page.goto(`/#/rules/${id}?node=transform`);
  await expect(page.getByLabel("Field 1 name", { exact: true })).toHaveValue(
    "name",
  );
  await page.getByLabel("Field 1 name", { exact: true }).fill("displayName");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await page.getByLabel("Field 3 name", { exact: true }).fill("status");
  await page.getByLabel("Constant type", { exact: true }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await page.getByLabel("Field 3 value", { exact: true }).fill("active");
  await focusNode(page, "Pricing tier");
  await expect(
    page.locator(
      '.react-flow__node[data-id="choose"] .react-flow__handle.source',
    ),
  ).toHaveCount(3);
  await page.getByLabel("Case 1 label", { exact: true }).fill("High value");
  await page
    .getByRole("button", { name: "Move case 2 up", exact: true })
    .click();
  await expect(page.getByLabel("Case 1 label", { exact: true })).toHaveValue(
    "Standard",
  );
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText(
    'field "displayName"',
  );
  const rendered = await (
    await request.post("/api/studio/render", {
      data: (await (await request.get(`/api/rules/${id}`)).json()).draft,
    })
  ).json();
  expect(rendered.source).toContain('case "premium"');
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  const definition = await save(page, request, id);
  expect(
    definition.nodes
      .find((node) => node.id === "choose")
      ?.cases?.map((option) => option.id),
  ).toEqual(["standard", "premium"]);
  expect(
    definition.edges
      .filter((edge) => edge.source === "choose")
      .map((edge) => edge.sourceHandle)
      .sort(),
  ).toEqual(["case:premium", "case:standard", "default"]);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const result = await (
    await request.post(`/api/rules/${id}/execute`, { data: { inputs: {} } })
  ).json();
  expect(result.result).toEqual({
    tier: "standard",
    data: { displayName: "ADA", amount: 150, status: "active" },
  });
  await page.screenshot({
    path: test.info().outputPath("switch-transform.png"),
    fullPage: true,
  });
  await focusNode(page, "Pricing tier");
  await page
    .getByRole("button", { name: "Remove case 2", exact: true })
    .click();
  const removed = await save(page, request, id);
  expect(
    removed.edges.some((edge) => edge.sourceHandle === "case:premium"),
  ).toBe(false);
  expect(
    removed.edges.some((edge) => edge.sourceHandle === "case:standard"),
  ).toBe(true);
  const pinned = await (
    await request.get(`/api/rules/${id}/versions/1`)
  ).json();
  expect(
    pinned.definition.nodes.find((node: { id: string }) => node.id === "choose")
      .cases,
  ).toHaveLength(2);
  await page.getByRole("button", { name: "Add case", exact: true }).click();
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  const newExit = page.locator(
    '.react-flow__node[data-id="choose"] .react-flow__handle.source[data-handleid^="case:case-"]',
  );
  await page
    .getByRole("button", { name: "Close outline", exact: true })
    .click();
  await newExit.dragTo(
    page.locator(
      '.react-flow__node[data-id="premium"] .react-flow__handle.target',
    ),
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  const reconnected = await save(page, request, id);
  const newCase = reconnected.nodes.find((node) => node.id === "choose")!
    .cases![1];
  expect(reconnected.edges).toContainEqual(
    expect.objectContaining({
      source: "choose",
      sourceHandle: `case:${newCase.id}`,
      target: "premium",
    }),
  );
});

test("Transform mappings can become a whole array expression without losing the draft on cancel", async ({
  page,
  request,
}) => {
  const id = await create(
    request,
    `
    inputs { items: ARRAY required default ["1.25", "2.50"]; }
    node input INPUT "Inputs" at (250, 0) { next -> transform; }
    node transform TRANSFORM "Normalize" at (250, 170) { field "items" = items; as normalized; next -> out; }
    node out OUTPUT "Output" at (250, 340) { return normalized; }
  `,
  );
  await page.goto(`/#/rules/${id}?node=transform`);
  await page
    .getByRole("button", {
      name: "Edit as one expression · Transform entire value",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /Expression editor/ });
  await expect(dialog.locator(".view-lines")).toContainText(
    'OBJECT("items", items)',
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Field 1 name", { exact: true })).toHaveValue(
    "items",
  );
  await page
    .getByRole("button", {
      name: "Edit as one expression · Transform entire value",
      exact: true,
    })
    .click();
  await replaceExpression(page, dialog, "MAP(items, item, TO_NUMBER(item))");
  await expect(
    dialog.getByRole("button", { name: "Apply expression" }),
  ).toBeEnabled();
  await dialog.screenshot({
    path: test.info().outputPath("expression-editor.png"),
  });
  await dialog.getByRole("button", { name: "Apply expression" }).click();
  await expect(
    page.getByLabel("Transform expression", { exact: true }),
  ).toHaveValue("MAP(items, item, TO_NUMBER(item))");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("[1.25,2.5]");
  const definition = await save(page, request, id);
  expect(
    definition.nodes.find((node) => node.id === "transform")?.fields,
  ).toBeNull();
  await page.reload();
  await expect(
    page.getByLabel("Transform expression", { exact: true }),
  ).toHaveValue("MAP(items, item, TO_NUMBER(item))");
});

test("late expression checks cannot override newer text or reenable Apply", async ({
  page,
  request,
}) => {
  const id = await create(
    request,
    `node input INPUT "Input" { next -> out; } node out OUTPUT "Output" { return 1; }`,
  );
  await page.goto(`/#/rules/${id}?node=out`);
  await page.getByLabel("Return value · value source", { exact: true }).click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Functions & editor · Return value",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /Expression editor/ });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false,
    delivered = false;
  await page.route("**/api/studio/expression/check", async (route) => {
    if (route.request().postDataJSON().expression !== "42") {
      await route.continue();
      return;
    }
    held = true;
    await gate;
    await route.fulfill({ json: { valid: true, variables: [], error: null } });
    delivered = true;
  });
  try {
    await replaceExpression(page, dialog, "42");
    await expect.poll(() => held).toBe(true);
    await replaceExpression(page, dialog, "1 +");
    await expect(dialog.getByRole("alert")).toContainText(
      "Incomplete expression",
    );
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "Apply expression" }),
    ).toBeDisabled();
    await expect(dialog.locator(".view-lines")).toContainText("1 +");
  } finally {
    release();
  }
});
