import { expect, test, type Page } from "@playwright/test";
import type { Definition, RuleNode } from "../src/types";
const node = (
  id: string,
  type: RuleNode["type"],
  expression?: string,
  output?: string,
  x = 300,
  y = 0,
): RuleNode => ({
  id,
  type,
  label: id,
  expression,
  output,
  position: { x, y },
});
const edge = (source: string, target: string, sourceHandle = "next") => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  target,
  sourceHandle,
});
async function select(page: Page, label: string, option: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}
async function focus(page: Page, name: string) {
  if (!(await page.locator(".node-outline").isVisible()))
    await page
      .getByRole("button", { name: "Node outline", exact: true })
      .click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}

test("settings modal and runtime/validation errors jump to the failing node from graph and studio", async ({
  page,
  request,
}) => {
  const id = `editor-error-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node("bad", "FORMULA", "1 / 0", "x", 300, 180),
      node("output", "OUTPUT", "x", undefined, 300, 360),
    ],
    edges: [edge("input", "bad"), edge("bad", "output")],
  };
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: "Error navigation", kind: "FORMULA", definition },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${id}`);
  const gear = page.getByRole("button", { name: "Rule settings", exact: true });
  await gear.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Rule settings");
  await gear.click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Updated error navigation");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Updated error navigation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Rule settings", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await page
    .getByRole("button", { name: "Show problem · bad", exact: true })
    .click();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "bad",
  );
  await expect(page.locator('.react-flow__node[data-id="bad"]')).toHaveClass(
    /selected/,
  );
  await page.getByLabel("Expression", { exact: true }).fill("missing + 1");
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show problem · bad", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Expression", { exact: true }).fill("1 / 0");
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await page
    .getByRole("button", { name: "Show problem · bad", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/rules/${id}`));
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "bad",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
  expect((await (await request.get(`/api/rules/${id}`)).json()).name).toBe(
    "Updated error navigation",
  );
});

test("connected parameter dropdowns, unquoted string constants and reference tabs preserve the draft", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const childId = `editor-child-${stamp}`,
    id = `editor-parent-${stamp}`;
  const child: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "name", type: "STRING", required: true, defaultValue: null },
      { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    ],
    nodes: [
      node("input", "INPUT"),
      node("out", "OUTPUT", 'CONCAT(name, ":", amount)', undefined, 300, 180),
    ],
    edges: [edge("input", "out")],
  };
  const created = await (
    await request.post("/api/rules", {
      data: {
        id: childId,
        name: "String mapping child",
        kind: "FORMULA",
        definition: child,
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/rules/${childId}/publish`, {
        data: { revision: created.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 5 },
      { name: "name", type: "STRING", required: true, defaultValue: "Ada" },
    ],
    nodes: [
      node("input", "INPUT"),
      node("base", "FORMULA", "amount * 2", "base", 300, 160),
      {
        ...node("reuse", "REFERENCE", undefined, "reused", 300, 320),
        ruleId: childId,
        version: 1,
        bindings: { amount: "base", name: "name" },
      },
      node("future", "FORMULA", "10", "future", 300, 480),
      node("out", "OUTPUT", "reused", undefined, 300, 640),
    ],
    edges: [
      edge("input", "base"),
      edge("base", "reuse"),
      edge("reuse", "future"),
      edge("future", "out"),
    ],
  };
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: "Mapping parent", kind: "FORMULA", definition },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${id}`);
  await focus(page, "reuse");
  await expect(
    page.getByLabel("amount * · value source", { exact: true }),
  ).toHaveText("Upstream variable");
  await page.getByLabel("amount *", { exact: true }).click();
  await expect(page.getByRole("option", { name: /base · base/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /future/ })).toHaveCount(0);
  await page.getByRole("option", { name: /base · base/ }).click();
  await select(page, "name * · value source", "Constant");
  const text = 'A "quoted" \\ path';
  await page.getByLabel("name *", { exact: true }).fill(text);
  await expect(
    page.getByText("Text value · no quotation marks needed"),
  ).toBeVisible();
  await page.getByLabel("Node name", { exact: true }).fill("Edited reuse");
  const pop = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open referenced rule", exact: true })
    .click();
  const tab = await pop;
  await expect(tab).toHaveURL(new RegExp(`/rules/${childId}\\?version=1`));
  await expect(tab.getByText("Immutable published version")).toBeVisible();
  await tab.close();
  await expect(page.getByLabel("Node name", { exact: true })).toHaveValue(
    "Edited reuse",
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText(
    JSON.stringify(`${text}:10`),
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
  const saved = await (await request.get(`/api/rules/${id}`)).json();
  expect(
    saved.draft.nodes.find((n: RuleNode) => n.id === "reuse").bindings.name,
  ).toBe(JSON.stringify(text));
  await page.reload();
  await focus(page, "Edited reuse");
  await expect(page.getByLabel("name *", { exact: true })).toHaveValue(text);
  await page.getByLabel("name *", { exact: true }).fill("");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText('\":10\"');
});

test("condition string builder quotes text and graph connections retain multiple downstream edges", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const conditionId = `editor-condition-${stamp}`,
    id = `editor-fanout-${stamp}`;
  const condition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "tier", type: "STRING", required: true, defaultValue: "premium" },
    ],
    nodes: [
      node("input", "INPUT"),
      node("check", "CONDITION", 'tier == "standard"', undefined, 300, 160),
      node("yes", "OUTPUT", "true", undefined, 0, 340),
      node("no", "OUTPUT", "false", undefined, 600, 340),
    ],
    edges: [
      edge("input", "check"),
      edge("check", "yes", "true"),
      edge("check", "no", "false"),
    ],
  };
  await request.post("/api/rules", {
    data: {
      id: conditionId,
      name: "String condition",
      kind: "RULE",
      definition: condition,
    },
  });
  await page.goto(`/#/rules/${conditionId}`);
  await expect(
    page.getByLabel("Comparison value", { exact: true }),
  ).toHaveValue("standard");
  await page
    .getByLabel("Comparison value", { exact: true })
    .fill('R&D | "premium"');
  await expect(
    page.getByLabel("Comparison value", { exact: true }),
  ).toHaveValue('R&D | "premium"');
  await page.getByLabel("When", { exact: true }).fill('"😀"');
  await page.getByLabel("Comparison value", { exact: true }).fill("😀");
  await expect(page.locator(".expression-preview")).toHaveText('"😀" == "😀"');
  await page.getByLabel("When", { exact: true }).fill("tier");
  await page.getByLabel("Comparison value", { exact: true }).fill("premium");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("true");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node("base", "FORMULA", "100", "base", 300, 160),
      node("tax", "OUTPUT", "base * 0.1", undefined, 0, 340),
      node("shipping", "OUTPUT", "base * 0.05", undefined, 600, 340),
    ],
    edges: [edge("input", "base"), edge("base", "tax")],
  };
  await request.post("/api/rules", {
    data: { id, name: "Fanout canvas", kind: "FORMULA", definition },
  });
  await page.goto(`/#/rules/${id}`);
  await page.reload(); // API-created fixture is newer than this tab's library snapshot.
  const from = page.locator(
    '.react-flow__node[data-id="base"] .react-flow__handle.source',
  );
  const to = page.locator(
    '.react-flow__node[data-id="shipping"] .react-flow__handle.target',
  );
  await from.dragTo(to);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await from.dragTo(to);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText(
    '{"shipping":5,"tax":10}',
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const result = await (
    await request.post(`/api/rules/${id}/execute`, { data: { inputs: {} } })
  ).json();
  expect(result.result).toEqual({ tax: 10, shipping: 5 });
  expect(
    result.trace.filter((s: { nodeId: string }) => s.nodeId === "base"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText('next -> "shipping"');
  await expect(page.locator(".view-lines")).toContainText('next -> "tax"');
});

test("errors inside reused rules open the failing published node in a separate tab", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const childId = `editor-bad-child-${stamp}`,
    id = `editor-bad-parent-${stamp}`;
  const child: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      node("broken", "OUTPUT", "1 / 0", undefined, 300, 160),
    ],
    edges: [edge("input", "broken")],
  };
  const created = await (
    await request.post("/api/rules", {
      data: {
        id: childId,
        name: "Broken child",
        kind: "FORMULA",
        definition: child,
      },
    })
  ).json();
  await request.post(`/api/rules/${childId}/publish`, {
    data: { revision: created.revision },
  });
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      node("input", "INPUT"),
      {
        ...node("reuse", "REFERENCE", undefined, "x", 300, 160),
        ruleId: childId,
        version: 1,
        bindings: {},
      },
      node("out", "OUTPUT", "x", undefined, 300, 320),
    ],
    edges: [edge("input", "reuse"), edge("reuse", "out")],
  };
  await request.post("/api/rules", {
    data: { id, name: "Broken parent", kind: "FORMULA", definition },
  });
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show problem · reuse", exact: true }),
  ).toBeVisible();
  const pop = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open problem · broken ↗", exact: true })
    .click();
  const tab = await pop;
  await expect(tab.getByLabel("Node name", { exact: true })).toHaveValue(
    "broken",
  );
  await expect(tab.locator('.react-flow__node[data-id="broken"]')).toHaveClass(
    /selected/,
  );
  await tab.close();
  await expect(page).toHaveURL(new RegExp(`/rules/${id}`));
});
