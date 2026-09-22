import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

test("a failed published version cannot expose the draft and can be retried", async ({
  page,
  request,
}) => {
  const id = `version-failure-${Date.now()}`;
  const createdResponse = await request.post("/api/rules", {
    data: { id, name: "Version failure fixture", kind: "FORMULA" },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const created: Rule = await createdResponse.json();
  const publishedResponse = await request.post(`/api/rules/${id}/publish`, {
    data: { revision: created.revision },
  });
  expect(publishedResponse.ok()).toBeTruthy();
  const published: Rule = await publishedResponse.json();
  expect(
    (
      await request.put(`/api/rules/${id}`, {
        data: {
          name: created.name,
          description: created.description,
          revision: published.revision,
          definition: {
            ...created.draft,
            nodes: created.draft.nodes.map((node) =>
              node.type === "FORMULA"
                ? { ...node, label: "Draft-only calculation", expression: "21" }
                : node,
            ),
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  let failVersion = true;
  await page.route(`**/api/rules/${id}/versions/1`, async (route) => {
    if (failVersion)
      await route.fulfill({
        status: 503,
        json: { message: "Version store unavailable" },
      });
    else await route.continue();
  });
  const graphRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      /\/api\/(studio\/render|diagnostics|variables|preview|validate)$/.test(
        outgoing.url(),
      )
    )
      graphRequests.push(outgoing.url());
  });

  await page.goto(`/#/studio/${id}?version=1`);
  await expect(page.getByRole("alert")).toContainText(
    "Could not load version 1",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Version store unavailable",
  );
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Test rule", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export definition", exact: true }),
  ).toHaveCount(0);
  expect(graphRequests).toEqual([]);

  await page
    .getByRole("button", { name: "Open current draft", exact: true })
    .click();
  await expect(
    page.getByText("Draft-only calculation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("21");

  await page.goto(`/#/rules/${id}?version=1`);
  await expect(page.getByRole("alert")).toContainText(
    "Could not load version 1",
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(
    page.getByText("Draft-only calculation", { exact: true }),
  ).toHaveCount(0);
  failVersion = false;
  await page
    .getByRole("button", { name: "Retry version", exact: true })
    .click();
  await expect(page.getByText("Immutable published version")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(
    published.draft.nodes.length,
  );
  await expect(
    page.getByText("Draft-only calculation", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("90");
});

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
