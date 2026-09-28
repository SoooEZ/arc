import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule as createApiRule, publishRule } from "./helpers/api";

/*
 * Cards, menus, the inspector, library previews, the Script outline and the
 * minimap all present node kinds from domain/nodeKinds. This workflow pins the
 * classes, labels and handles each kind shows, which the stylesheets and
 * routing rely on.
 */

async function createRule(
  request: APIRequestContext,
  id: string,
  name: string,
  definition: Definition,
  publish: boolean,
) {
  const rule = await createApiRule(request, {
    id,
    name,
    kind: "DECISION_TREE",
    definition,
  });
  if (publish) await publishRule(request, rule);
}

function childRule(): Definition {
  return {
    schemaVersion: 1,
    inputs: [{ name: "x", type: "NUMBER", required: true, defaultValue: null }],
    nodes: [
      { id: "in", type: "INPUT", label: "In", position: { x: 0, y: 0 } },
      {
        id: "twice",
        type: "OUTPUT",
        label: "Twice",
        expression: "x * 2",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [{ id: "e", source: "in", target: "twice", sourceHandle: "next" }],
  };
}

/** A valid graph with one or more nodes of every kind. */
function everyKind(childId: string): Definition {
  const at = (x: number, y: number) => ({ x, y });
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: at(400, 0) },
      {
        id: "check",
        type: "CONDITION",
        label: "Large amount",
        expression: "amount > 5",
        position: at(400, 180),
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Double",
        expression: "amount * 2",
        output: "total",
        position: at(100, 360),
      },
      {
        id: "pick",
        type: "SWITCH",
        label: "Pick band",
        cases: [
          { id: "high", label: "High", expression: "total > 10" },
          { id: "mid", label: "Mid", expression: "total > 5" },
        ],
        position: at(100, 540),
      },
      {
        id: "done",
        type: "OUTPUT",
        label: "Total",
        expression: "total",
        position: at(100, 760),
      },
      {
        id: "shape",
        type: "TRANSFORM",
        label: "Shape",
        fields: [{ name: "value", expression: "amount" }],
        output: "shaped",
        position: at(700, 360),
      },
      {
        id: "reuse",
        type: "REFERENCE",
        label: "Reuse child",
        ruleId: childId,
        version: 1,
        bindings: { x: "amount" },
        output: "reused",
        position: at(700, 540),
      },
      {
        id: "done2",
        type: "OUTPUT",
        label: "Reused",
        expression: "reused",
        position: at(700, 760),
      },
    ],
    edges: [
      { id: "a", source: "input", target: "check", sourceHandle: "next" },
      { id: "b", source: "check", target: "calc", sourceHandle: "true" },
      { id: "c", source: "check", target: "shape", sourceHandle: "false" },
      { id: "d", source: "calc", target: "pick", sourceHandle: "next" },
      { id: "e", source: "pick", target: "done", sourceHandle: "case:high" },
      { id: "f", source: "pick", target: "done", sourceHandle: "case:mid" },
      { id: "g", source: "pick", target: "done", sourceHandle: "default" },
      { id: "h", source: "shape", target: "reuse", sourceHandle: "next" },
      { id: "i", source: "reuse", target: "done2", sourceHandle: "next" },
    ],
  };
}

interface Expected {
  label: string;
  key: string;
  kindLabel: string;
  detail: string;
  targets: number;
  sources: number;
  storesResult: boolean;
  removable: boolean;
}

function expectations(childId: string): Record<string, Expected> {
  const step = { targets: 1, sources: 1, removable: true };
  return {
    input: {
      label: "Inputs",
      key: "input",
      kindLabel: "Input",
      detail: "1 input parameter",
      targets: 0,
      sources: 1,
      storesResult: false,
      removable: false,
    },
    check: {
      ...step,
      label: "Large amount",
      key: "condition",
      kindLabel: "Condition",
      detail: "amount > 5",
      sources: 2,
      storesResult: false,
    },
    calc: {
      ...step,
      label: "Double",
      key: "formula",
      kindLabel: "Formula",
      detail: "amount * 2",
      storesResult: true,
    },
    pick: {
      ...step,
      label: "Pick band",
      key: "switch",
      kindLabel: "Switch",
      detail: "2 cases · first match + default",
      sources: 3,
      storesResult: false,
    },
    done: {
      ...step,
      label: "Total",
      key: "output",
      kindLabel: "Output",
      detail: "total",
      sources: 0,
      storesResult: false,
    },
    shape: {
      ...step,
      label: "Shape",
      key: "transform",
      kindLabel: "Transform",
      detail: "1 fields → shaped",
      storesResult: true,
    },
    reuse: {
      ...step,
      label: "Reuse child",
      key: "reference",
      kindLabel: "Reuse rule",
      detail: `${childId} · v1`,
      storesResult: true,
    },
    done2: {
      ...step,
      label: "Reused",
      key: "output",
      kindLabel: "Output",
      detail: "reused",
      sources: 0,
      storesResult: false,
    },
  };
}

const card = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (text: string) => new RegExp(`^${escaped(text)}$`);

async function expectClass(target: Locator, name: string, present: boolean) {
  const pattern = new RegExp(`\\b${name}\\b`);
  if (present) await expect(target).toHaveClass(pattern);
  else await expect(target).not.toHaveClass(pattern);
}

test("every node kind shows its own classes, labels, handles and sections", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const childId = `kinds-child-${stamp}`;
  const id = `kinds-parent-${stamp}`;
  const name = `Every node kind ${stamp}`;
  await createRule(request, childId, `Kinds child ${stamp}`, childRule(), true);
  await createRule(request, id, name, everyKind(childId), false);
  const expected = Object.entries(expectations(childId));

  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(
    page.getByText("Graph is valid. All paths lead to a result."),
  ).toBeVisible();

  for (const [nodeId, kind] of expected) {
    const node = card(page, nodeId);
    const graphNode = node.locator(".graph-node");
    await expectClass(graphNode, `node-${kind.key}`, true);
    await expectClass(graphNode, "node-error", false);
    await expect(
      node.locator(`.node-type-line .node-icon.${kind.key}`),
      nodeId,
    ).toHaveCount(1);
    await expect(node.locator(".node-type-line"), nodeId).toContainText(
      kind.kindLabel,
    );
    await expect(node.locator(".node-detail"), nodeId).toHaveText(kind.detail);
    await expect(
      node.locator(".react-flow__handle.target"),
      nodeId,
    ).toHaveCount(kind.targets);
    await expect(
      node.locator(".react-flow__handle.source"),
      nodeId,
    ).toHaveCount(kind.sources);
  }
  // Fallback exits (False, Default) draw their connections alike, unlike the others.
  const stroke = (edgeId: string) =>
    page
      .locator(`.react-flow__edge-path#${edgeId}`)
      .evaluate((path) => getComputedStyle(path).stroke);
  expect(await stroke("g")).toBe(await stroke("c"));
  expect(await stroke("e")).toBe(await stroke("b"));
  expect(await stroke("g")).not.toBe(await stroke("e"));
  // Fallback exits (False, Default) have their own caption style.
  const caption = (nodeId: string, text: string) =>
    card(page, nodeId).locator(".handle-caption", { hasText: exactly(text) });
  await expectClass(caption("check", "True"), "handle-fallback", false);
  await expectClass(caption("check", "False"), "handle-fallback", true);
  await expectClass(caption("pick", "High"), "handle-fallback", false);
  await expectClass(caption("pick", "Mid"), "handle-fallback", false);
  await expectClass(caption("pick", "Default"), "handle-fallback", true);
  // Cards are 230px wide; a Switch with three exits widens to 270px.
  await expect(card(page, "pick").locator(".graph-node")).toHaveCSS(
    "width",
    "270px",
  );
  await expect(card(page, "check").locator(".graph-node")).toHaveCSS(
    "width",
    "230px",
  );

  // Only Conditions stand out on the minimap.
  const minimapNodes = page.locator(".react-flow__minimap-node");
  await expect(minimapNodes).toHaveCount(8);
  const fills = await minimapNodes.evaluateAll((rects) =>
    rects.map((rect) => getComputedStyle(rect).fill).sort(),
  );
  expect(fills).toEqual([
    ...Array(7).fill("rgb(212, 223, 216)"),
    "rgb(232, 216, 178)",
  ]);

  // The Add node menu offers every kind but Input, in a fixed order.
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText([
    "Formula",
    "Condition",
    "Switch",
    "Transform",
    "Reuse rule",
    "Output",
  ]);
  const keys = ["formula", "condition", "switch", "transform", "reference"];
  for (const [index, key] of [...keys, "output"].entries())
    await expect(items.nth(index).locator(`.node-icon.${key}`)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(items).toHaveCount(0);

  // The inspector names the kind and shows result and delete controls by kind.
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  for (const [nodeId, kind] of expected) {
    await page
      .locator(".node-outline button", {
        hasText: new RegExp(`^\\d{2}${escaped(kind.label)}$`),
      })
      .click();
    const identity = page.locator(".inspector-node-kind");
    await expect(identity, nodeId).toHaveText(kind.kindLabel);
    await expect(identity.locator(`.node-icon.${kind.key}`)).toHaveCount(1);
    await expect(
      page.getByLabel("Result variable", { exact: true }),
      nodeId,
    ).toHaveCount(kind.storesResult ? 1 : 0);
    await expect(
      page.getByRole("button", { name: "Delete node", exact: true }),
      nodeId,
    ).toHaveCount(kind.removable ? 1 : 0);
  }

  // The Script outline marks the nodes that end a path.
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  const outline = page.locator(".studio-outline");
  await expect(outline.locator("button")).toHaveCount(8);
  for (const [nodeId, kind] of expected) {
    const row = outline.locator("button", {
      hasText: exactly(`${kind.label}${kind.key}`),
    });
    await expect(row.locator("small"), nodeId).toHaveText(kind.key);
    await expectClass(row.locator(".status-dot"), "published", !kind.sources);
  }

  // Library previews color and title nodes by the same kind keys and labels.
  await page.goto("/#/library");
  await page.getByRole("textbox", { name: "Search rules" }).fill(name);
  const preview = page
    .locator(".rule-card", {
      has: page.getByRole("heading", { name, exact: true }),
    })
    .locator(".rule-preview-svg");
  await expect(preview).toBeVisible();
  for (const [nodeId, kind] of expected) {
    const node = preview.locator(`[data-preview-node="${nodeId}"]`);
    await expectClass(node, `preview-node-${kind.key}`, true);
    await expect(node.locator("title"), nodeId).toHaveText(
      `${kind.label} · ${kind.kindLabel}`,
    );
  }
});
