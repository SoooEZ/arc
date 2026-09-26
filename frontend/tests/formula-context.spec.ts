import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

async function fixtures(request: APIRequestContext) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const callee = `fc-${suffix}`;
  const caller = `context-${suffix}`;
  const definition = (
    expression: string,
    inputs: Definition["inputs"],
  ): Definition => ({
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
        expression: "amount + price",
        position: { x: 250, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "end", source: "calc", target: "out", sourceHandle: "next" },
    ],
  });
  const amount = {
    name: "amount",
    type: "NUMBER" as const,
    required: true,
    defaultValue: 25,
  };
  const created = await request.post("/api/rules", {
    data: {
      id: callee,
      name: `Price formula ${suffix}`,
      kind: "FORMULA",
      definition: definition("amount * (1 + rate)", [
        amount,
        { name: "rate", type: "NUMBER", required: false, defaultValue: 0.1 },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const published: Rule = await created.json();
  expect(
    (
      await request.post(`/api/rules/${callee}/publish`, {
        data: { revision: published.revision },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post("/api/rules", {
        data: {
          id: caller,
          name: caller,
          kind: "FORMULA",
          definition: definition(`@${callee}:1(amount)`, [
            amount,
            {
              name: "items",
              type: "ARRAY",
              required: true,
              defaultValue: [1, 2],
            },
            {
              name: "customer",
              type: "OBJECT",
              required: true,
              defaultValue: { rows: [{ amount: 7 }] },
            },
          ]),
        },
      })
    ).status(),
  ).toBe(201);
  return { caller, callee, label: `Price formula ${suffix}` };
}

// Read rendered characters rather than relying on Monaco's generated span
// classes; wrapped calls may occupy more than one view line.
async function paintedFragment(
  input: Locator,
  fragment: string,
  occurrence = 0,
) {
  return editorLines(input).evaluate(
    (lines, { fragment, occurrence }) => {
      const characters: { node: Node; offset: number; color: string }[] = [];
      let text = "";
      for (const line of lines.querySelectorAll(".view-line")) {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const content = (node.textContent ?? "").replace(/\u00a0/g, " ");
          const color = getComputedStyle(node.parentElement!).color;
          for (let offset = 0; offset < content.length; offset++)
            characters.push({ node, offset, color });
          text += content;
          node = walker.nextNode();
        }
      }
      let start = -1;
      for (let index = 0; index <= occurrence; index++) {
        start = text.indexOf(fragment, start + 1);
        if (start < 0) return null;
      }
      const at = characters[start + Math.min(1, fragment.length - 1)];
      const range = document.createRange();
      range.setStart(at.node, at.offset);
      range.setEnd(at.node, at.offset + 1);
      const bounds = range.getBoundingClientRect();
      return {
        colors: characters
          .slice(start, start + fragment.length)
          .map((character) => character.color),
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
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
    .poll(
      async () => (await paintedFragment(input, fragment, occurrence))?.colors,
    )
    .toEqual(Array<string>(fragment.length).fill(color));
}

async function showHover(
  page: Page,
  input: Locator,
  fragment: string,
  occurrence = 0,
) {
  if (await page.locator(".monaco-hover:visible").count())
    await page.keyboard.press("Escape");
  const point = await paintedFragment(input, fragment, occurrence);
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  // Monaco's Show Hover shortcut requests help immediately, so negative
  // lexical-context assertions do not depend on the mouse-hover delay.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("ControlOrMeta+i");
  return page.locator(".monaco-hover:visible");
}

test("variable hover identifies inputs and results but respects collection locals and numeric property paths", async ({
  page,
  request,
}) => {
  const { caller } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=out`);
  const expression = page.getByLabel("Return value", { exact: true });
  await expectColor(expression, "amount", "rgb(32, 95, 166)");
  await expectColor(expression, "price", "rgb(123, 63, 152)");
  let hover = await showHover(page, expression, "amount");
  await expect(hover).toContainText("Input · number");
  await expect(hover).toContainText("From: Customer inputs");
  hover = await showHover(page, expression, "price");
  await expect(hover).toContainText("Node result");
  await expect(hover).toContainText("From: Calculate price");
  await setEditorText(
    page,
    expression,
    "$SUM($MAP(items, amount, amount + price))",
  );
  for (const occurrence of [0, 1]) {
    await expectColor(expression, "amount", "rgb(82, 102, 93)", occurrence);
    hover = await showHover(page, expression, "amount", occurrence);
    await expect(hover).toContainText("Collection-local variable");
    await expect(hover).not.toContainText("Input · number");
    await expect(hover).not.toContainText("From: Customer inputs");
  }
  await setEditorText(page, expression, "customer.rows.0.amount + amount");
  await expectColor(expression, "customer", "rgb(32, 95, 166)");
  await expectColor(expression, "amount", "rgb(32, 95, 166)", 1);
  hover = await showHover(page, expression, "amount");
  await expect(hover).toHaveCount(0);
  hover = await showHover(page, expression, "amount", 1);
  await expect(hover).toContainText("Input · number");
});

test("literal at signs do not fetch formula metadata or offer formula completions and hover", async ({
  page,
  request,
}) => {
  const { caller, callee } = await fixtures(request);
  const formulaRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      (url.pathname === "/api/rule-summaries" &&
        url.searchParams.get("kind") === "FORMULA" &&
        url.searchParams.get("publishedOnly") === "true") ||
      url.pathname.startsWith(`/api/rules/${callee}`)
    )
      formulaRequests.push(url.pathname + url.search);
  });
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await expect(editorLines(expression)).toHaveText(`@${callee}:1(amount)`);
  for (const prefix of ['"', "'", "// "]) {
    await setEditorText(page, expression, "");
    await page.keyboard.type(`${prefix}@${callee}:1(amount)`);
    await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(editorLines(expression)).toContainText(`@${callee}:1(amount)`);
    const hover = await showHover(page, expression, `@${callee}:1`);
    await expect(hover).toHaveCount(0);
  }
  expect(formulaRequests).toEqual([]);
});

test("pinned formulas retain their color and published parameter help in node and whole-rule code editors", async ({
  page,
  request,
}) => {
  const { caller, callee, label } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=calc`);
  await page
    .locator(".inspector-sidebar")
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Node expression · Calculate price",
    exact: true,
  });
  const nodeCode = dialog.getByLabel("Node code editor", { exact: true });
  const call = `@${callee}:1`;
  await expectColor(nodeCode, call, "rgb(0, 124, 131)");
  let hover = await showHover(page, nodeCode, call);
  await expect(hover).toContainText(label);
  await expect(hover).toContainText("Published Formula");
  await expect(hover).toContainText("version 1");
  await expect(hover).toContainText("amount (number) · required");
  await expect(hover).toContainText("rate (number) · optional · default 0.1");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const code = page.getByLabel("ARC code editor", { exact: true });
  await expectColor(code, call, "rgb(0, 124, 131)");
  hover = await showHover(page, code, call);
  await expect(hover).toContainText(label);
  await expect(hover).toContainText("Published Formula");
  await expect(hover).toContainText("rate (number) · optional · default 0.1");
  await page.screenshot({
    path: test.info().outputPath("formula-code-hover.png"),
  });
});

test("editing an inferred Output expression retains its editor through empty text, literals and formula completion", async ({
  page,
  request,
}) => {
  const { caller, callee } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=out`);
  const expression = page.getByLabel("Return value", { exact: true });
  const source = page.getByRole("combobox", {
    name: "Return value · value source",
    exact: true,
  });
  await expect(source).toContainText("Expression");
  await setEditorText(page, expression, "");
  await expect(editorLines(expression)).toHaveText("");
  await expect(source).toContainText("Expression");
  const literal = JSON.stringify(`literal @${callee}:1`);
  await page.keyboard.type(literal);
  await expect(editorLines(expression)).toHaveText(literal);
  await expect(source).toContainText("Expression");
  await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
  await setEditorText(page, expression, "");
  await expect(editorLines(expression)).toHaveText("");
  const scope = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/variables")) return false;
    const draft = response.request().postDataJSON() as Definition;
    return (
      draft.nodes
        .find((node) => node.id === "out")
        ?.expression?.startsWith(`@${callee}`) ?? false
    );
  });
  await page.keyboard.type(`@${callee}`);
  await scope;
  await expect(
    page
      .locator(".suggest-widget.visible")
      .getByRole("option", { name: new RegExp(`@${callee}:1`) }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorLines(expression)).toHaveText(`@${callee}:1(amount)`);
  await expect(source).toContainText("Expression");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${caller}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "out")?.expression).toBe(
    `@${callee}:1(amount)`,
  );
});
