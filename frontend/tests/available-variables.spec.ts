import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition } from "../src/types";

function definition(connected = false): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 25 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 150, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression: "amount * 2",
        output: "price",
        position: { x: 150, y: 180 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose value",
        selector: connected ? "amount" : "true",
        cases: [{ id: "one", label: "One", expression: "true" }],
        position: { x: 150, y: 400 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      ...(connected
        ? [
            {
              id: "incoming",
              source: "calc",
              target: "choose",
              sourceHandle: "next",
            },
          ]
        : []),
    ],
  };
}

async function create(request: APIRequestContext, draft: Definition) {
  const id = `variable-scope-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition: draft },
  });
  expect(response.status()).toBe(201);
  return id;
}

test("Switch upstream choices follow its incoming connections and preserve an unavailable selection", async ({
  page,
  request,
}) => {
  const disconnected = definition();
  for (const [draft, expected] of [
    [disconnected, []],
    [definition(true), ["amount", "price"]],
  ] as const) {
    const response = await request.post("/api/variables", { data: draft });
    expect(response.ok()).toBeTruthy();
    const scope = await response.json();
    expect(scope.input).toEqual(["amount"]);
    expect(scope.choose).toEqual(expected);
  }
  const id = await create(request, disconnected);
  await page.goto(`/#/rules/${id}?node=choose`);
  const inspector = page.locator(".inspector");
  await expect(inspector.getByLabel("Node name", { exact: true })).toHaveValue(
    "Choose value",
  );
  await expect(inspector.locator(".variable-list code")).toHaveCount(0);
  await inspector
    .getByRole("combobox", {
      name: "Value to match · value source",
      exact: true,
    })
    .click();
  await page
    .getByRole("option", { name: "Upstream variable", exact: true })
    .click();
  await expect(
    inspector.getByText(
      "No compatible upstream variables are available at this node.",
      { exact: true },
    ),
  ).toBeVisible();
  await inspector
    .getByRole("combobox", { name: "Value to match", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: /amount · Input/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  const source = page.locator(
    '.react-flow__node[data-id="calc"] .react-flow__handle.source',
  );
  const target = page.locator(
    '.react-flow__node[data-id="choose"] .react-flow__handle.target',
  );
  await source.hover();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const incoming = page.locator(
    '.react-flow__edge[aria-label="Edge from calc to choose"]',
  );
  await expect(incoming).toHaveCount(1);
  await expect(inspector.locator(".variable-list code")).toHaveText([
    "amount",
    "price",
  ]);
  await inspector
    .getByRole("combobox", { name: "Value to match", exact: true })
    .click();
  await page.getByRole("option", { name: /amount · Input/ }).click();
  await expect(page.locator(".MuiMenu-root")).toHaveCount(0);
  await expect(
    inspector.getByRole("combobox", { name: "Value to match", exact: true }),
  ).toContainText("amount");

  const point = await incoming
    .locator(".react-flow__edge-path")
    .evaluate((path: SVGPathElement) => {
      const center = path
        .getPointAtLength(path.getTotalLength() / 2)
        .matrixTransform(path.getScreenCTM()!);
      return { x: center.x, y: center.y };
    });
  await page.mouse.click(point.x, point.y);
  await page
    .getByRole("button", { name: "Delete connection", exact: true })
    .click();
  await expect(incoming).toHaveCount(0);
  await expect(inspector.locator(".variable-list code")).toHaveCount(0);
  await expect(
    inspector.getByRole("combobox", { name: "Value to match", exact: true }),
  ).toContainText("amount · unavailable");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await (await request.get(`/api/rules/${id}`)).json())
    .draft as Definition;
  expect(saved.nodes.find((node) => node.id === "choose")?.selector).toBe(
    "amount",
  );
  expect(saved.edges.some((edge) => edge.target === "choose")).toBe(false);
});

test("pending and failed variable reads do not invent input choices or erase the current expression", async ({
  page,
  request,
}) => {
  const id = await create(request, definition(true));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/variables", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({
      status: 503,
      json: { message: "Scope service unavailable" },
    });
  });
  try {
    await page.goto(`/#/rules/${id}?node=choose`);
    const inspector = page.locator(".inspector");
    await expect.poll(() => requested).toBe(true);
    await expect(inspector.locator(".variable-list code")).toHaveCount(0);
    await expect(
      inspector.getByRole("combobox", { name: "Value to match", exact: true }),
    ).toContainText("amount · unavailable");
    const response = page.waitForResponse(
      (received) =>
        received.url().endsWith("/api/variables") && received.status() === 503,
    );
    release();
    await response;
    await expect(inspector.locator(".variable-list code")).toHaveCount(0);
    await expect(
      inspector.getByRole("combobox", { name: "Value to match", exact: true }),
    ).toContainText("amount · unavailable");
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
});
