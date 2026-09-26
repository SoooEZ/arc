import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";
function definition(
  expression: string,
  inputs: Definition["inputs"],
): Definition {
  return {
    schemaVersion: 1,
    inputs,
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Customer inputs",
        position: { x: 250, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression,
        output: "price",
        position: { x: 250, y: 180 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "$ROUND(price, 2)",
        position: { x: 250, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "end", source: "calc", target: "out", sourceHandle: "next" },
    ],
  };
}
async function fixtures(request: APIRequestContext) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amount = {
    name: "amount",
    type: "NUMBER" as const,
    required: true,
    defaultValue: null,
  };
  const callee = `formula-price-${suffix}`;
  const response = await request.post("/api/rules", {
    data: {
      id: callee,
      name: `Tax formula ${suffix}`,
      kind: "FORMULA",
      definition: definition("amount * (1 + rate)", [
        amount,
        { name: "rate", type: "NUMBER", required: false, defaultValue: 0.1 },
      ]),
    },
  });
  expect(response.status()).toBe(201);
  const rule: Rule = await response.json();
  expect(
    (
      await request.post(`/api/rules/${callee}/publish`, {
        data: { revision: rule.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const caller = `formula-caller-${suffix}`;
  expect(
    (
      await request.post("/api/rules", {
        data: {
          id: caller,
          name: caller,
          kind: "FORMULA",
          definition: definition("amount", [{ ...amount, defaultValue: 100 }]),
        },
      })
    ).status(),
  ).toBe(201);
  return { callee, caller, suffix };
}
test("at completion pins a formula and hover explains input, formula and result symbols", async ({
  page,
  request,
}) => {
  const { callee, caller, suffix } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await expect(editorLines(expression)).toHaveText("amount");
  await editorLines(expression)
    .locator("span")
    .filter({ hasText: /^amount$/ })
    .first()
    .hover();
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "Input · number",
  );
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "Customer inputs",
  );
  await setEditorText(page, expression, "");
  await page.keyboard.type(`@${callee}`);
  await expect(
    page
      .locator(".suggest-widget.visible")
      .getByRole("option", { name: new RegExp(`@${callee}:1`) }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorLines(expression)).toHaveText(`@${callee}:1(amount)`);
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 10);
  await editorLines(expression)
    .locator("span")
    .filter({ hasText: /^@formula-price-/ })
    .first()
    .hover();
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    `Tax formula ${suffix}`,
  );
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "version 1",
  );
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "rate (number) · optional · default 0.1",
  );
  await page.keyboard.press("Escape");
  await page.mouse.move(500, 500);
  await expect(page.locator(".monaco-hover:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("110");
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.locator('.react-flow__node[data-id="out"] .graph-node').click();
  const result = page.getByLabel("Return value", { exact: true });
  await editorLines(result)
    .locator("span")
    .filter({ hasText: /^price$/ })
    .first()
    .hover();
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "Node result",
  );
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "Calculate price",
  );
  await page.screenshot({
    path: test.info().outputPath("formula-symbol-help.png"),
  });
});
test("formula picker preserves pins after publication and ignores late insertion after edits", async ({
  page,
  request,
}) => {
  const { callee, caller, suffix } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=calc`);
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Expression",
    exact: true,
  });
  const expression = dialog.getByLabel("Expression code editor", {
    exact: true,
  });
  await setEditorText(page, expression, "");
  await dialog.getByRole("button", { name: "@ Formulas", exact: true }).click();
  await dialog.getByLabel("Find published formula").fill(suffix);
  await dialog
    .getByRole("button", { name: new RegExp(`Tax formula ${suffix}`) })
    .click();
  await expect(editorLines(expression)).toHaveText(`@${callee}:1(amount)`);
  await dialog
    .getByRole("button", { name: "Apply expression", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const previous: Rule = await (
    await request.get(`/api/rules/${callee}`)
  ).json();
  previous.draft.nodes.find((node) => node.id === "calc")!.expression =
    "amount * 2";
  const updated = await request.put(`/api/rules/${callee}`, {
    data: {
      name: previous.name,
      description: previous.description,
      revision: previous.revision,
      definition: previous.draft,
    },
  });
  expect(updated.ok()).toBeTruthy();
  const saved: Rule = await updated.json();
  expect(
    (
      await request.post(`/api/rules/${callee}/publish`, {
        data: { revision: saved.revision },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await (
        await request.post("/api/preview", {
          data: {
            definition: (
              (await (await request.get(`/api/rules/${caller}`)).json()) as Rule
            ).draft,
            inputs: {},
          },
        })
      ).json()
    ).result,
  ).toBe(110);
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "@ Formulas", exact: true }).click();
  await dialog.getByLabel("Find published formula").fill(suffix);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/rules/${callee}/versions/2`, async (route) => {
    await blocked;
    await route.continue();
  });
  await dialog
    .getByRole("button", { name: new RegExp(`Tax formula ${suffix}`) })
    .click();
  await setEditorText(page, expression, "amount + 7");
  release();
  await expect(dialog.getByRole("alert")).toContainText(
    "The expression changed while the formula loaded",
  );
  await expect(editorLines(expression)).toHaveText("amount + 7");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    editorLines(page.getByLabel("Expression", { exact: true })),
  ).toHaveText(`@${callee}:1(amount)`);
});

test("formula runtime errors open the pinned child node and preserve unsaved caller edits", async ({
  page,
  request,
}) => {
  const { callee, caller, suffix } = await fixtures(request);
  const child: Rule = await (await request.get(`/api/rules/${callee}`)).json();
  child.draft.nodes.find((node) => node.id === "calc")!.expression =
    "amount / 0";
  const updated = await request.put(`/api/rules/${callee}`, {
    data: {
      name: child.name,
      description: child.description,
      revision: child.revision,
      definition: child.draft,
    },
  });
  expect(updated.ok()).toBeTruthy();
  const saved: Rule = await updated.json();
  expect(
    (
      await request.post(`/api/rules/${callee}/publish`, {
        data: { revision: saved.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${caller}?node=calc`);
  await page
    .getByLabel("Node name", { exact: true })
    .fill("Caller unsaved edit");
  await setEditorText(
    page,
    page.getByLabel("Expression", { exact: true }),
    `@${callee}:2(amount)`,
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open problem · Calculate price",
      exact: true,
    })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "Referenced rule viewer",
    exact: true,
  });
  await expect(
    viewer.getByRole("heading", { name: `Tax formula ${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(
    viewer.locator('.react-flow__node[data-id="calc"] .graph-node'),
  ).toHaveClass(/node-error/);
  await expect(
    editorLines(viewer.getByLabel("Expression", { exact: true })),
  ).toHaveText("amount / 0");
  await expect(
    viewer.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await viewer.getByRole("button", { name: "Close all", exact: true }).click();
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Caller unsaved edit",
  );
  await expect(
    editorLines(page.getByLabel("Expression", { exact: true })),
  ).toHaveText(`@${callee}:2(amount)`);
});
