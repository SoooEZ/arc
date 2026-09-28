import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 20 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Calculate",
      expression: "amount * 2",
      output: "total",
      position: { x: 200, y: 180 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Return total",
      expression: "total",
      position: { x: 200, y: 360 },
    },
  ],
  edges: [
    { id: "start", source: "input", sourceHandle: "next", target: "calc" },
    { id: "finish", source: "calc", sourceHandle: "next", target: "out" },
  ],
};

async function create(request: APIRequestContext, draft = definition) {
  const id = `node-names-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition: draft },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Rule;
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
}

async function rejectInvalidNames(input: Locator, previous: string) {
  for (const name of ["bad name", "bad$name", "bad@name"]) {
    await input.fill(name);
    await expect(input).toHaveValue(previous);
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }
  for (const text of ["bad\tname", "bad\nname"]) {
    await input.evaluate((element, pasted) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", pasted);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    }, text);
    await expect(input).toHaveValue(previous);
  }
}

test("input and every result-producing node use the same identifier restrictions without saving rejected edits", async ({
  page,
  request,
}) => {
  const draft = structuredClone(definition);
  draft.nodes.push(
    {
      id: "transform",
      type: "TRANSFORM",
      label: "Transform",
      fields: [{ name: "literal field", expression: "1" }],
      output: "data",
      position: { x: 500, y: 180 },
    },
    {
      id: "reuse",
      type: "REFERENCE",
      label: "Reuse",
      bindings: {},
      output: "reused",
      position: { x: 800, y: 180 },
    },
  );
  const rule = await create(request, draft);
  await page.goto(`/#/rules/${rule.id}`);
  for (const [node, label, original, accepted] of [
    ["input", "Parameter name", "amount", "input_amount"],
    ["calc", "Result variable", "total", "calculated_total"],
    ["transform", "Result variable", "data", "transformed_data"],
    ["reuse", "Result variable", "reused", "reused_value"],
  ]) {
    await page
      .locator(`.react-flow__node[data-id="${node}"] .graph-node`)
      .click();
    const input = page.getByLabel(label, { exact: true });
    await expect(input).toHaveValue(original);
    await rejectInvalidNames(input, original);
    await input.fill("true");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill(accepted);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await save(page);
  }
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.inputs[0].name).toBe("input_amount");
  expect(saved.draft.nodes.find((node) => node.id === "calc")?.output).toBe(
    "calculated_total",
  );
  expect(
    saved.draft.nodes.find((node) => node.id === "transform")?.output,
  ).toBe("transformed_data");
  expect(saved.draft.nodes.find((node) => node.id === "reuse")?.output).toBe(
    "reused_value",
  );
  expect(
    saved.draft.nodes.find((node) => node.id === "transform")?.fields?.[0].name,
  ).toBe("literal field");
});

test("named Outputs survive graph/code and staged edits, preserve null and published versions, and can return a raw value again", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=out`);
  const alias = page.getByLabel("Output name", { exact: true });
  await expect(alias).toHaveValue("");
  await rejectInvalidNames(alias, "");
  await alias.fill("final_total");
  await expect(page.getByLabel("Return value preview")).toContainText(
    '{ "final_total": total }',
  );
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const run = async (expected: unknown) => {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText(
      JSON.stringify(expected),
    );
  };
  await run({ final_total: 40 });
  await page
    .getByRole("combobox", { name: "Return value · value source", exact: true })
    .click();
  await page.getByRole("option", { name: "Constant", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Constant type", exact: true })
    .click();
  await page.getByRole("option", { name: "null", exact: true }).click();
  await run({ final_total: null });
  await expect(alias).toHaveValue("final_total");
  await page
    .getByRole("combobox", { name: "Return value · value source", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Upstream variable", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Return value", exact: true })
    .click();
  await page
    .getByRole("option", { name: "total [result] from Calculate", exact: true })
    .click();
  await save(page);
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(
    editorLines(page.getByLabel("ARC code editor", { exact: true })),
  ).toContainText("as final_total;");
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  await expect(page.getByText("Code built. Graph is valid.")).toBeVisible();
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(alias).toHaveValue("final_total");
  await page
    .locator(".inspector-sidebar")
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const nodeCode = page.getByRole("dialog", {
    name: "Node expression · Return total",
    exact: true,
  });
  const code = nodeCode.getByLabel("Node code editor", { exact: true });
  await expect(editorLines(code)).toContainText("as final_total;");
  await setEditorText(
    page,
    code,
    'node out OUTPUT "Return total" at (200, 360) { return total; as payable; }',
  );
  await nodeCode
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(alias).toHaveValue("payable");
  const card = page.locator('.react-flow__node[data-id="out"] .graph-node');
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const form = page.getByRole("dialog", { name: /^Edit node/ });
  await form.getByLabel("Output name", { exact: true }).fill("discarded");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(alias).toHaveValue("payable");
  await save(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const execute = async (version: number) => {
    const response = await request.post(`/api/rules/${rule.id}/execute`, {
      data: { inputs: {}, version },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).result;
  };
  expect(await execute(1)).toEqual({ payable: 40 });
  await alias.fill("");
  await save(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 2 published and ready to call"),
  ).toBeVisible();
  expect(await execute(2)).toBe(40);
  expect(await execute(1)).toEqual({ payable: 40 });
  await page.goto(`/#/rules/${rule.id}?version=1&node=out`);
  await expect(alias).toHaveValue("payable");
  await expect(alias).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("named-output.png") });
});

test("Switch default return edits the connected Output name and preserves it when its value changes", async ({
  page,
  request,
}) => {
  const draft: Definition = structuredClone(definition);
  draft.nodes[1] = {
    id: "choose",
    type: "SWITCH",
    label: "Choose",
    cases: [{ id: "never", label: "Never", expression: "false" }],
    position: { x: 200, y: 180 },
  };
  draft.nodes[2].expression = "amount";
  draft.nodes.push({
    id: "other",
    type: "OUTPUT",
    label: "Other",
    expression: "0",
    position: { x: 500, y: 360 },
  });
  draft.edges = [
    { id: "start", source: "input", sourceHandle: "next", target: "choose" },
    { id: "default", source: "choose", sourceHandle: "default", target: "out" },
    {
      id: "case",
      source: "choose",
      sourceHandle: "case:never",
      target: "other",
    },
  ];
  const rule = await create(request, draft);
  await page.goto(`/#/rules/${rule.id}?node=choose`);
  const defaults = page.getByTestId("switch-default-return");
  await defaults.getByLabel("Output name", { exact: true }).fill("fallback");
  await defaults
    .getByRole("combobox", {
      name: "Default return value · value source",
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "Constant", exact: true }).click();
  await defaults.getByLabel("Default return value", { exact: true }).fill("7");
  await expect(defaults.getByLabel("Output name", { exact: true })).toHaveValue(
    "fallback",
  );
  await save(page);
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "out")).toMatchObject({
    expression: "7",
    outputName: "fallback",
  });
  const preview = await request.post("/api/preview", {
    data: { definition: saved.draft, inputs: {} },
  });
  expect(preview.ok(), await preview.text()).toBeTruthy();
  expect((await preview.json()).result).toEqual({ fallback: 7 });
});

test("a stored invalid result name can be shortened and repaired while prohibited typing stays rejected", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  // Drafts saved before result names were validated can still hold one.
  await page.route(`**/api/rules/${rule.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const legacy: Rule = await response.json();
    legacy.draft.nodes.find((node) => node.id === "calc")!.output =
      "order-total";
    await route.fulfill({ response, json: legacy });
  });
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const field = page.getByLabel("Result variable", { exact: true });
  await expect(field).toHaveValue("order-total");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("order-tota");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.type(" ");
  await expect(field).toHaveValue("order-tota");
  await page.keyboard.press("Home");
  for (let step = 0; step < "order".length; step++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(field).toHaveValue("ordertota");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.keyboard.press("End");
  await page.keyboard.type("l");
  await expect(field).toHaveValue("ordertotal");
  await save(page);
  const saved: Rule = await (await request.get(`/api/rules/${rule.id}`)).json();
  expect(saved.draft.nodes.find((node) => node.id === "calc")?.output).toBe(
    "ordertotal",
  );
});

test("a refused paste stops being reported once the name changes through the node dialog", async ({
  page,
  request,
}) => {
  const rule = await create(request);
  await page.goto(`/#/rules/${rule.id}?node=calc`);
  const field = page.getByLabel("Result variable", { exact: true });
  await expect(field).toHaveValue("total");
  await field.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "bad name");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  });
  await expect(field).toHaveValue("total");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/No spaces, \$ or @/).first()).toBeVisible();
  await page
    .locator('.react-flow__node[data-id="calc"] .graph-node')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Edit node/ });
  await dialog
    .getByLabel("Result variable", { exact: true })
    .fill("grand_total");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  // The refusal belonged to "total"; the sidebar field shows the new valid name as valid.
  await expect(field).toHaveValue("grand_total");
  await expect(field).toHaveAttribute("aria-invalid", "false");
});
