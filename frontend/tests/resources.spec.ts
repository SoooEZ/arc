import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";

test("moving a node reuses semantic reads and late diagnostics cannot mark a newer expression", async ({
  page,
  request,
}) => {
  const id = `resource-regression-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "calculate",
        type: "FORMULA",
        label: "Calculation",
        expression: "1 + 1",
        output: "total",
        position: { x: 300, y: 180 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "total",
        position: { x: 300, y: 360 },
      },
    ],
    edges: [
      { id: "a", source: "input", target: "calculate", sourceHandle: "next" },
      { id: "b", source: "calculate", target: "output", sourceHandle: "next" },
    ],
  };
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: "Resource regression", kind: "FORMULA", definition },
      })
    ).status(),
  ).toBe(201);
  const reads = { variables: 0, diagnostics: 0 };
  page.on("request", (request) => {
    if (request.url().endsWith("/api/variables")) reads.variables++;
    if (request.url().endsWith("/api/diagnostics")) reads.diagnostics++;
  });
  await page.goto(`/#/rules/${id}`);
  const node = page.locator('.react-flow__node[data-id="calculate"]');
  await node.locator(".graph-node").click();
  await expect(page.getByLabel("Expression", { exact: true })).toHaveValue(
    "1 + 1",
  );
  await expect.poll(() => reads.variables).toBeGreaterThan(0);
  await expect.poll(() => reads.diagnostics).toBeGreaterThan(0);
  const before = { ...reads };
  const position = await node.getAttribute("style");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(node).not.toHaveAttribute("style", position!);
  // Wait beyond both debounce windows to assert that position-only edits cause no reads.
  await page.waitForTimeout(650);
  expect(reads).toEqual(before);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let delivered = false;
  await page.route("**/api/diagnostics", async (route) => {
    const graph = route.request().postDataJSON() as Definition;
    if (
      graph.nodes.find((node) => node.id === "calculate")?.expression !==
      "missing + 1"
    ) {
      await route.continue();
      return;
    }
    held = true;
    await gate;
    await route.fulfill({
      json: [
        {
          message: "Stale unknown variable",
          locations: [{ nodeId: "calculate" }],
        },
      ],
    });
    delivered = true;
  });
  try {
    await page.getByLabel("Expression", { exact: true }).fill("missing + 1");
    await expect.poll(() => held).toBe(true);
    const currentCheck = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/diagnostics") &&
        response
          .request()
          .postDataJSON()
          .nodes.some(
            (node: { expression: string }) => node.expression === "42",
          ),
    );
    await page.getByLabel("Expression", { exact: true }).fill("42");
    expect((await currentCheck).ok()).toBe(true);
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(node.locator(".graph-node")).not.toHaveClass(/node-error/);
    await expect(
      page.getByText("Stale unknown variable", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Expression", { exact: true })).toHaveValue(
      "42",
    );
  } finally {
    release();
  }
});
