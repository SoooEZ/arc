import { expect, test } from "@playwright/test";
import { arrangeGraph } from "../src/graphLayout";
import type { Definition, RuleNode } from "../src/types";
import { branchHandleX, defaultNodeSize } from "../src/graphGeometry";

function node(
  id: string,
  type: RuleNode["type"],
  x: number,
  y: number,
): RuleNode {
  return {
    id,
    type,
    label: id,
    position: { x, y },
    ...(type === "CONDITION"
      ? { expression: "amount >= 100" }
      : type === "OUTPUT"
        ? { expression: id === "approved" ? '"approved"' : '"declined"' }
        : {}),
  };
}
const split: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
  ],
  notes: ["Layout must preserve business logic."],
  // False is deliberately first and on the left: the screenshot's inversion.
  nodes: [
    node("input", "INPUT", 150, 0),
    node("decision", "CONDITION", 150, 180),
    node("declined", "OUTPUT", 0, 360),
    node("approved", "OUTPUT", 350, 360),
  ],
  edges: [
    { id: "start", source: "input", target: "decision", sourceHandle: "next" },
    {
      id: "false-edge",
      source: "decision",
      target: "declined",
      sourceHandle: "false",
    },
    {
      id: "true-edge",
      source: "decision",
      target: "approved",
      sourceHandle: "true",
    },
  ],
};
const x = (d: Definition, id: string) =>
  d.nodes.find((n) => n.id === id)!.position.x;
const withoutPositions = (d: Definition) => ({
  ...d,
  nodes: d.nodes.map(({ position: _position, ...node }) => node),
});

test("layout detects the reversed True/False targets and moves nodes without changing logic", async () => {
  const before = structuredClone(split);
  expect(x(before, "approved")).toBeGreaterThan(x(before, "declined"));
  const arranged = await arrangeGraph(before);
  expect(x(arranged, "approved")).toBeLessThan(x(arranged, "declined"));
  expect(branchHandleX.true).toBeLessThan(branchHandleX.false);
  expect(withoutPositions(arranged)).toEqual(withoutPositions(before));
  expect(before).toEqual(split);
  const positions = Object.fromEntries(
    arranged.nodes.map((n) => [n.id, n.position]),
  );
  const repeated = await arrangeGraph(arranged);
  expect(
    Object.fromEntries(repeated.nodes.map((n) => [n.id, n.position])),
  ).toEqual(positions);
  const permuted = await arrangeGraph({
    ...before,
    nodes: [...before.nodes].reverse(),
    edges: [...before.edges].reverse(),
  });
  expect(
    Object.fromEntries(permuted.nodes.map((n) => [n.id, n.position])),
  ).toEqual(positions);
});

test("nested splits, unequal measured sizes, and a shared descendant remain connected without overlap", async () => {
  const d: Definition = {
    ...split,
    nodes: [
      node("input", "INPUT", 0, 0),
      node("a", "CONDITION", 0, 0),
      node("b", "CONDITION", 0, 0),
      node("c", "CONDITION", 0, 0),
      node("approved", "OUTPUT", 0, 0),
      node("declined", "OUTPUT", 0, 0),
    ],
    edges: [
      { id: "1", source: "input", target: "a", sourceHandle: "next" },
      { id: "2", source: "a", target: "b", sourceHandle: "true" },
      { id: "3", source: "a", target: "c", sourceHandle: "false" },
      { id: "4", source: "b", target: "approved", sourceHandle: "true" },
      { id: "5", source: "b", target: "declined", sourceHandle: "false" },
      { id: "6", source: "c", target: "approved", sourceHandle: "true" },
      { id: "7", source: "c", target: "declined", sourceHandle: "false" },
    ],
  };
  const sizes = {
    b: { width: 310, height: 180 },
    approved: { width: 290, height: 150 },
  };
  const arranged = await arrangeGraph(d, sizes);
  expect(withoutPositions(arranged)).toEqual(withoutPositions(d));
  expect(x(arranged, "approved")).toBeLessThan(x(arranged, "declined"));
  for (const a of arranged.nodes)
    for (const b of arranged.nodes)
      if (a.id !== b.id) {
        const sa = sizes[a.id as keyof typeof sizes] || defaultNodeSize;
        const sb = sizes[b.id as keyof typeof sizes] || defaultNodeSize;
        const overlap =
          a.position.x < b.position.x + sb.width &&
          a.position.x + sa.width > b.position.x &&
          a.position.y < b.position.y + sb.height &&
          a.position.y + sa.height > b.position.y;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
});

test("layout supports incomplete drafts and rejects invalid handles without dropping edges", async () => {
  const draft = { ...split, edges: split.edges.slice(0, 1) };
  const arranged = await arrangeGraph(draft);
  expect(arranged.nodes).toHaveLength(draft.nodes.length);
  expect(arranged.edges).toEqual(draft.edges);
  for (const n of arranged.nodes)
    expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(
      true,
    );
  const invalid = {
    ...split,
    edges: [{ ...split.edges[0], sourceHandle: "false" }],
  };
  await expect(arrangeGraph(invalid)).rejects.toThrow("valid node handles");
});

test("Arrange graph uncrosses branches, persists layout, and preserves both execution results", async ({
  page,
  request,
}) => {
  const id = `layout-e2e-${Date.now()}`;
  const create = await request.post("/api/rules", {
    data: {
      id,
      name: "Layout regression",
      kind: "DECISION_TREE",
      definition: split,
    },
  });
  expect(create.ok()).toBeTruthy();
  await page.goto(`/#/rules/${id}`);
  const approved = page.locator('.react-flow__node[data-id="approved"]');
  const declined = page.locator('.react-flow__node[data-id="declined"]');
  await expect(approved).toBeVisible();
  expect((await approved.boundingBox())!.x).toBeGreaterThan(
    (await declined.boundingBox())!.x,
  );
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await approved.boundingBox())!.x < (await declined.boundingBox())!.x,
    )
    .toBe(true);
  const saveResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/rules/${id}`) && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await (await saveResponse).json();
  expect(saved.draft.edges).toEqual(split.edges);
  expect(withoutPositions(saved.draft)).toMatchObject(withoutPositions(split));
  expect(x(saved.draft, "approved")).toBeLessThan(x(saved.draft, "declined"));
  for (const [amount, expected] of [
    [150, "approved"],
    [50, "declined"],
  ] as const) {
    const result = await request.post("/api/preview", {
      data: { definition: saved.draft, inputs: { amount } },
    });
    expect(result.ok()).toBeTruthy();
    expect((await result.json()).result).toBe(expected);
  }
  await page.reload();
  await expect(approved).toBeVisible();
  expect((await approved.boundingBox())!.x).toBeLessThan(
    (await declined.boundingBox())!.x,
  );
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  const rendered = await (
    await request.post("/api/studio/render", { data: saved.draft })
  ).json();
  const rebuilt = await (
    await request.post("/api/studio/build", { data: rendered })
  ).json();
  expect(rebuilt.diagnostics).toEqual([]);
  expect(rebuilt.definition.nodes.map((n: RuleNode) => n.position)).toEqual(
    saved.draft.nodes.map((n: RuleNode) => n.position),
  );
});
