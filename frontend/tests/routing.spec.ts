import { expect, test, type Page } from "@playwright/test";
import {
  routeEdge,
  type Endpoint,
  type RoutingNode,
} from "../src/features/editor/canvas/edgeRouting";
import type { Definition, Rule } from "../src/types";

const box = (
  id: string,
  x: number,
  y: number,
  width = 230,
  height = 105,
): RoutingNode => ({ id, x, y, width, height });
const port = (
  n: RoutingNode,
  side: "top" | "bottom",
  ratio = 0.5,
): Endpoint => ({
  x: n.x + n.width * ratio,
  y: n.y + (side === "bottom" ? n.height : 0),
  nodeId: n.id,
  side,
});

function assertClear(source: Endpoint, target: Endpoint, nodes: RoutingNode[]) {
  const before = structuredClone(nodes);
  const route = routeEdge(source, target, nodes);
  expect(route).not.toBeNull();
  expect(route!.points[0]).toMatchObject({ x: source.x, y: source.y });
  expect(route!.points.at(-1)).toMatchObject({ x: target.x, y: target.y });
  for (let i = 1; i < route!.points.length; i++) {
    const a = route!.points[i - 1],
      b = route!.points[i];
    expect(a.x === b.x || a.y === b.y).toBe(true);
    // Independent sampling of every segment against actual card bounds.
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let j = 0; j <= steps; j++) {
      const x = a.x + ((b.x - a.x) * j) / steps;
      const y = a.y + ((b.y - a.y) * j) / steps;
      const hit = nodes.find(
        (n) =>
          x > n.x + 0.01 &&
          x < n.x + n.width - 0.01 &&
          y > n.y + 0.01 &&
          y < n.y + n.height - 0.01,
      );
      if (hit) throw new Error(`Route crosses ${hit.id} at (${x}, ${y})`);
    }
  }
  expect(nodes).toEqual(before);
  return route!;
}

test("routes a long connection around the intermediate discount card, with deterministic geometry", () => {
  const nodes = [
    box("premium", 100, 0),
    box("volume", 200, 180),
    box("result", 200, 360),
  ];
  const source = port(nodes[0], "bottom"),
    target = port(nodes[2], "top");
  const route = assertClear(source, target, nodes);
  expect(route.points.some((p) => p.x < 200 || p.x > 430)).toBe(true);
  expect(routeEdge(source, target, [...nodes].reverse())).toEqual(route);
});

test("routes True/False fan-out, joins, upward edges and unequal nodes without crossing any card", () => {
  const nodes = [
    box("decision", 100, 100),
    box("left", -220, 380, 300, 150),
    box("right", 260, 380),
    box("join", 100, 720, 330, 130),
    box("obstacle", 80, 560, 180, 100),
  ];
  for (const source of [
    port(nodes[0], "bottom", 0.27),
    port(nodes[0], "bottom", 0.73),
  ])
    for (const target of [port(nodes[1], "top"), port(nodes[2], "top")])
      assertClear(source, target, nodes);
  for (const n of [nodes[1], nodes[2]])
    assertClear(port(n, "bottom"), port(nodes[3], "top"), nodes);
  assertClear(port(nodes[3], "bottom"), port(nodes[0], "top"), nodes);
  assertClear(port(nodes[1], "bottom"), port(nodes[2], "top"), nodes);
});

test("narrow gaps remain routable, covered ports report failure, and free-pointer previews avoid obstacles", () => {
  const nodes = [box("source", 0, 0), box("target", 0, 125)];
  assertClear(port(nodes[0], "bottom"), port(nodes[1], "top"), nodes);
  const covered = [...nodes, box("cover", 60, 80)];
  expect(
    routeEdge(port(nodes[0], "bottom"), port(nodes[1], "top"), covered),
  ).toBeNull();
  const obstacles = [nodes[0], box("obstacle", 0, 200)];
  assertClear(port(nodes[0], "bottom"), { x: 115, y: 420 }, obstacles);
  assertClear({ x: 115, y: -120 }, port(nodes[0], "top"), obstacles);
});

test("routes through multiple staggered obstacles in a larger graph", () => {
  const nodes = [box("source", 0, 0), box("target", 700, 2100)];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 5; col++)
      nodes.push(
        box(`${row}-${col}`, col * 280 - (row % 2) * 120, row * 220 + 200),
      );
  const start = performance.now();
  const route = routeEdge(
    port(nodes[0], "bottom"),
    port(nodes[1], "top"),
    nodes,
  );
  expect(performance.now() - start).toBeLessThan(1000);
  expect(route).not.toBeNull();
  assertClear(port(nodes[0], "bottom"), port(nodes[1], "top"), nodes);
});

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 200, y: 0 } },
    {
      id: "blocker",
      type: "FORMULA",
      label: "Intermediate calculation",
      expression: "2",
      output: "value",
      position: { x: 200, y: 185 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Final result",
      expression: "42",
      position: { x: 200, y: 390 },
    },
  ],
  edges: [
    { id: "direct", source: "input", target: "out", sourceHandle: "next" },
    { id: "first", source: "input", target: "blocker", sourceHandle: "next" },
    { id: "second", source: "blocker", target: "out", sourceHandle: "next" },
  ],
};

async function fixture(page: Page, draft = definition) {
  let rule: Rule = {
    id: "routing-fixture",
    name: "Routing regression",
    description: "",
    kind: "DECISION_TREE",
    draft: structuredClone(draft),
    revision: 1,
    publishedVersion: 1,
    createdAt: "2026-09-17T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
  };
  // Keep geometry tests isolated from the user's database, including Save draft.
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url === "/api/rules") return route.fulfill({ json: [rule] });
    if (url === "/api/rules/routing-fixture") {
      if (route.request().method() === "PUT") {
        rule = {
          ...rule,
          draft: route.request().postDataJSON().definition,
          revision: rule.revision + 1,
        };
      }
      return route.fulfill({ json: rule });
    }
    if (url.endsWith("/versions/1"))
      return route.fulfill({
        json: {
          ruleId: rule.id,
          version: 1,
          definition: rule.draft,
          publishedAt: rule.createdAt,
        },
      });
    if (url === "/api/variables") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return () => rule;
}

async function collisions(page: Page) {
  return page.locator(".react-flow").evaluate((flow) => {
    const boxes = [...flow.querySelectorAll(".graph-node")].map((n) =>
      n.getBoundingClientRect(),
    );
    const paths = [
      ...flow.querySelectorAll<SVGPathElement>(
        ".react-flow__edge-path, .react-flow__connection-path",
      ),
    ];
    const failures: string[] = [];
    for (const path of paths) {
      const length = path.getTotalLength(),
        matrix = path.getScreenCTM()!;
      for (let i = 2; i < length - 2; i += 2) {
        const p = path.getPointAtLength(i).matrixTransform(matrix);
        if (
          boxes.some(
            (b) =>
              p.x > b.left + 1 &&
              p.x < b.right - 1 &&
              p.y > b.top + 1 &&
              p.y < b.bottom - 1,
          )
        ) {
          failures.push(path.id || "connection-preview");
          break;
        }
      }
    }
    return failures;
  });
}

test("rendered paths avoid cards on load, during dragging, after arranging and in saved versions", async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.goto("/#/rules/routing-fixture");
  const paths = page.locator(".react-flow__edge-path");
  await expect(paths).toHaveCount(3);
  await expect.poll(() => collisions(page)).toEqual([]);
  const direct = page.locator("path#direct");
  const before = await direct.getAttribute("d");
  const blocker = page.locator('.react-flow__node[data-id="blocker"]');
  const box = (await blocker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 40, { steps: 12 });
  await expect.poll(() => direct.getAttribute("d")).not.toBe(before);
  await expect.poll(() => collisions(page)).toEqual([]);
  await page.mouse.up();
  // New connections use the same routing while the pointer is still free.
  const handle = page.locator('.react-flow__node[data-id="input"] .source');
  const h = (await handle.boundingBox())!;
  const canvas = (await page.locator(".flow-container").boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 60, canvas.y + canvas.height - 70, {
    steps: 10,
  });
  await expect(page.locator(".react-flow__connection-path")).toBeVisible();
  await expect.poll(() => collisions(page)).toEqual([]);
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => collisions(page)).toEqual([]);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(saved().draft.edges).toEqual(definition.edges);
  await page.goto("/#/rules/routing-fixture?version=1");
  await expect(paths).toHaveCount(3);
  await expect.poll(() => collisions(page)).toEqual([]);
  await page.screenshot({ path: "test-results/routing-arranged.png" });
});

test("covered ports show a navigable warning and recover after Arrange graph; routed edges remain selectable", async ({
  page,
}) => {
  await fixture(page, {
    ...definition,
    nodes: definition.nodes.map((n) =>
      n.id === "blocker" ? { ...n, position: { x: 200, y: 70 } } : n,
    ),
  });
  await page.goto("/#/rules/routing-fixture");
  const warning = page.locator(".routing-warning");
  await expect(warning).toContainText("Connections blocked");
  await warning
    .getByRole("button", { name: "Input → Final result", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete connection" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  await expect(warning).toHaveCount(0);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
  await expect.poll(() => collisions(page)).toEqual([]);
  const position = await page
    .locator("path#direct")
    .evaluate((p: SVGPathElement) => {
      const point = p
        .getPointAtLength(p.getTotalLength() / 2)
        .matrixTransform(p.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  await page.mouse.click(position.x, position.y);
  await page.getByRole("button", { name: "Delete connection" }).click();
  await expect(page.locator("path#direct")).toHaveCount(0);
});

test("zooming as Arrange fits the viewport cannot leave the draft locked", async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.goto("/#/rules/routing-fixture");
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
  const arrange = page.getByRole("button", {
    name: "Arrange graph",
    exact: true,
  });
  const interruption = page.locator(".react-flow__viewport").evaluate(
    (viewport) =>
      new Promise<{ fitted: string; zoomed: string }>((resolve) => {
        const flow = viewport.closest(".react-flow")!;
        const pane = flow.querySelector(".react-flow__pane")!;
        const blocker = flow.querySelector<HTMLElement>(
          '.react-flow__node[data-id="blocker"]',
        )!;
        const initialPosition = blocker.style.transform;
        const observer = new MutationObserver(() => {
          if (blocker.style.transform === initialPosition) return;
          observer.disconnect();
          const fitted = (viewport as HTMLElement).style.transform;
          const bounds = pane.getBoundingClientRect();
          // Interrupt the first rendered fit frame through React Flow's actual zoom handler.
          // An animated fit that resolves only on transition end will never release its lock.
          pane.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: 160,
              clientX: bounds.x + bounds.width / 2,
              clientY: bounds.y + bounds.height / 2,
            }),
          );
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                fitted,
                zoomed: (viewport as HTMLElement).style.transform,
              }),
            ),
          );
        });
        observer.observe(viewport, {
          attributes: true,
          attributeFilter: ["style"],
        });
      }),
  );
  await arrange.click();
  const viewport = await interruption;
  expect(viewport.zoomed).not.toBe(viewport.fitted);
  await expect(arrange).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(saved().draft.nodes.map((node) => node.position)).not.toEqual(
    definition.nodes.map((node) => node.position),
  );
  expect(saved().draft.edges).toEqual(definition.edges);
});
