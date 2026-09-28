import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
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

async function expectVariables(page: Page, names: string[]) {
  const source = page.getByRole("combobox", {
    name: "Case 1 value · value source",
    exact: true,
  });
  if ((await source.textContent()) !== "Expression") {
    await source.click();
    await page.getByRole("option", { name: "Expression", exact: true }).click();
  }
  await page
    .getByRole("button", {
      name: "Available variables · Case 1 value",
      exact: true,
    })
    .click();
  const overlay = page.getByRole("dialog", {
    name: "Available variables · Case 1 value",
    exact: true,
  });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".variable-list code")).toHaveText(names);
  if (!names.length)
    await expect(overlay).toContainText(
      "No upstream variables are available at this node.",
    );
  await overlay
    .getByRole("button", { name: "Close available variables", exact: true })
    .click();
  await expect(overlay).not.toBeVisible();
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
  await expectVariables(page, []);
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
    page.getByRole("option", {
      name: "amount [number] from Inputs",
      exact: true,
    }),
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
  await expectVariables(page, ["amount", "price"]);
  await inspector
    .getByRole("combobox", { name: "Value to match", exact: true })
    .click();
  await page
    .getByRole("option", { name: "amount [number] from Inputs", exact: true })
    .click();
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
  await expectVariables(page, []);
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
    await expectVariables(page, []);
    await expect(
      inspector.getByRole("combobox", { name: "Value to match", exact: true }),
    ).toContainText("amount · unavailable");
    const response = page.waitForResponse(
      (received) =>
        received.url().endsWith("/api/variables") && received.status() === 503,
    );
    release();
    await response;
    await expectVariables(page, []);
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

test("variable menus and expression tooltips show declared types and live producer names", async ({
  page,
  request,
}) => {
  const draft: Definition = {
    schemaVersion: 1,
    inputs: [
      {
        name: "hello",
        type: "OBJECT",
        required: true,
        defaultValue: { score: 7 },
      },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 200, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Compute score",
        expression: '$GET(hello, "score", 0)',
        output: "score",
        position: { x: 200, y: 180 },
      },
      {
        id: "result",
        type: "OUTPUT",
        label: "Result",
        expression: "score",
        position: { x: 200, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "finish", source: "calc", target: "result", sourceHandle: "next" },
    ],
  };
  const id = await create(request, draft);
  await page.goto(`/#/rules/${id}?node=result`);
  const inspector = page.locator(".inspector-sidebar");
  const variable = inspector.getByRole("combobox", {
    name: "Return value",
    exact: true,
  });
  await variable.click();
  await expect(
    page.getByRole("option", {
      name: "hello [object] from Inputs",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", {
      name: "score [result] from Compute score",
      exact: true,
    }),
  ).toBeVisible();
  const option = page.getByRole("option", {
    name: "score [result] from Compute score",
    exact: true,
  });
  await expect(option.locator("strong")).toHaveText(["score", "Compute score"]);
  await expect(option.locator("strong").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(option.locator("strong").last()).toHaveCSS("font-weight", "700");
  await expect(option.locator("strong").last()).toHaveCSS(
    "font-style",
    "normal",
  );
  await expect(option.locator("em")).toHaveText("from");
  await expect(option.locator("em")).toHaveCSS("font-style", "italic");
  await expect(option.locator("em")).toHaveCSS("font-synthesis", "style");
  const sourceColor = await option
    .locator("strong")
    .last()
    .evaluate((element) => getComputedStyle(element).color);
  await expect(option.locator(".value-binding-variable-from")).not.toHaveCSS(
    "color",
    sourceColor,
  );
  await page.screenshot({
    path: test.info().outputPath("upstream-variable-options.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(variable).toHaveText("score [result] from Compute score");
  await expect(variable.locator("strong").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(variable.locator("strong").last()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(variable.locator("strong").last()).toHaveCSS(
    "font-style",
    "normal",
  );
  await expect(variable.locator("em")).toHaveCSS("font-style", "italic");
  await expect(variable.locator("em")).toHaveCSS("font-synthesis", "style");
  for (const [nodeId, label] of [
    ["input", "Customer data"],
    ["calc", "Normalize score"],
  ]) {
    await page
      .locator(`.react-flow__node[data-id="${nodeId}"] .graph-node`)
      .click();
    await inspector.getByLabel("Node name", { exact: true }).fill(label);
  }
  await page.locator('.react-flow__node[data-id="result"] .graph-node').click();
  await variable.click();
  await expect(
    page.getByRole("option", {
      name: "score [result] from Normalize score",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("option", {
      name: "hello [object] from Customer data",
      exact: true,
    })
    .click();
  await expect(variable).toHaveText("hello [object] from Customer data");
  await expect(variable.locator("strong")).toHaveText([
    "hello",
    "Customer data",
  ]);
  await expect(variable.locator("em")).toHaveText("from");
  await page.screenshot({
    path: test.info().outputPath("upstream-variable-selected.png"),
    animations: "disabled",
  });
  await expect(
    inspector.getByRole("button", { name: /^Available variables/ }),
  ).toHaveCount(0);
  await inspector
    .getByRole("combobox", { name: "Return value · value source", exact: true })
    .click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await inspector
    .getByRole("button", {
      name: "Available variables · Return value",
      exact: true,
    })
    .click();
  const variables = page.getByRole("dialog", {
    name: "Available variables · Return value",
    exact: true,
  });
  await variables
    .locator(".variable-list code")
    .filter({ hasText: /^hello$/ })
    .hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "hello [object] from Customer data",
  );
  await variables
    .getByRole("button", { name: "Close available variables", exact: true })
    .click();
  await inspector
    .getByRole("button", {
      name: "Open in Editor · Return value",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Return value",
    exact: true,
  });
  await dialog
    .getByRole("button", {
      name: "score [result] from Normalize score",
      exact: true,
    })
    .hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "score [result] from Normalize score",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = (await (await request.get(`/api/rules/${id}`)).json())
    .draft as Definition;
  expect(saved.nodes.find((node) => node.id === "result")?.expression).toBe(
    "hello",
  );
});

/** Input(amount) → calc (amount * 2 as price) → out, whose value is the variable price. */
function priced(): Definition {
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
        id: "out",
        type: "OUTPUT",
        label: "Total",
        expression: "price",
        position: { x: 150, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "finish", source: "calc", target: "out", sourceHandle: "next" },
    ],
  };
}

test("a content problem elsewhere keeps every scope, and an unknown scope neither blocks Apply nor erases a value", async ({
  page,
  request,
}) => {
  const id = await create(request, priced());
  await page.goto(`/#/rules/${id}?node=out`);
  const inspector = page.locator(".inspector");
  const returnValue = inspector.getByRole("combobox", {
    name: "Return value",
    exact: true,
  });
  const returnSource = inspector.getByRole("combobox", {
    name: "Return value · value source",
    exact: true,
  });
  await expect(returnValue).toContainText("price");
  await expect(returnValue).not.toContainText("unavailable");
  // A blank label is a content problem: the scope read still answers, for every node.
  const scopeRead = page.waitForResponse((response) =>
    response.url().endsWith("/api/variables"),
  );
  await inspector.getByLabel("Node name", { exact: true }).fill("");
  expect((await scopeRead).status()).toBe(200);
  await expect(returnValue).toContainText("price");
  await expect(returnValue).not.toContainText("unavailable");
  // A failed read (a cycle, or here a forced failure) leaves the scope unknown, not empty.
  await page.route("**/api/variables", (route) =>
    route.fulfill({
      status: 422,
      json: { message: "Decision graphs cannot contain cycles" },
    }),
  );
  const failedRead = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/variables") && response.status() === 422,
  );
  await inspector.getByLabel("Node name", { exact: true }).fill("Total");
  await failedRead;
  await expect(returnValue).toContainText("price · unavailable");
  await returnSource.click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await returnSource.click();
  await page
    .getByRole("option", { name: "Upstream variable", exact: true })
    .click();
  // Before, switching back erased the expression, and the editor has no undo.
  await expect(returnValue).toContainText("price · unavailable");
  await page.locator('.react-flow__node[data-id="calc"] .graph-node').click();
  await inspector
    .getByRole("button", { name: "Open in Editor · Expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Expression",
  });
  await expect(dialog).toContainText("Variable scope unavailable");
  await expect(dialog).not.toContainText("Unavailable variables");
  await expect(
    dialog.getByRole("button", { name: "Apply expression", exact: true }),
  ).toBeEnabled();
});
