import { expect, test, type Locator } from "@playwright/test";
import type { NodeType } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

const kinds: NodeType[] = [
  "INPUT",
  "FORMULA",
  "CONDITION",
  "SWITCH",
  "TRANSFORM",
  "REFERENCE",
  "OUTPUT",
];

const color = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).color);

test("library previews colour every node kind like its canvas icon", async ({
  page,
  request,
}) => {
  const id = uniqueId("kind-colors");
  const name = `Kind colours ${id}`;
  await createRule(request, {
    id,
    name,
    kind: "DECISION_TREE",
    definition: {
      schemaVersion: 1,
      inputs: [],
      nodes: kinds.map((type, index) => ({
        id: type.toLowerCase(),
        type,
        label: `${type.toLowerCase()} step`,
        position: { x: 0, y: index * 160 },
      })),
      edges: [
        { id: "e", source: "input", target: "formula", sourceHandle: "next" },
      ],
    },
  });

  await page.goto("/#/library");
  const card = page.locator(".rule-card", { hasText: name });
  await expect(card).toBeVisible();
  // The arrowhead and the connection it ends read one token.
  const arrowhead = await card
    .locator("marker path")
    .first()
    .evaluate((path) => getComputedStyle(path).fill);
  const connection = await card
    .locator(".preview-connection")
    .first()
    .evaluate((path) => getComputedStyle(path).stroke);
  expect(arrowhead).toBe(connection);
  const previewColors = new Map<NodeType, string>();
  for (const type of kinds) {
    const node = card.locator(`g[data-preview-node="${type.toLowerCase()}"]`);
    await expect(node).toBeAttached();
    previewColors.set(type, await color(node));
  }

  await page.goto(`/#/rules/${id}`);
  for (const type of kinds) {
    const icon = page.locator(
      `.react-flow__node[data-id="${type.toLowerCase()}"] .node-icon`,
    );
    await expect(icon).toBeVisible();
    expect(await color(icon), `${type} preview colour`).toBe(
      previewColors.get(type),
    );
  }
});
