import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Execution } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 300, y: 0 } },
    {
      id: "calculate",
      type: "FORMULA",
      label: "Calculation",
      expression: "amount * 2",
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
async function openRule(page: Page, request: APIRequestContext) {
  const id = uniqueId("execution-lifecycle");
  await createRule(request, {
    id,
    name: "Execution lifecycle",
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  return id;
}
async function holdPreview(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let delivered = false;
  const old: Execution = {
    ruleId: "preview",
    version: null,
    result: 20,
    durationMicros: 10,
    trace: [
      {
        ruleId: "preview",
        version: null,
        nodeId: "calculate",
        label: "Calculation",
        type: "FORMULA",
        value: 20,
        branch: "next",
        depth: 0,
      },
    ],
  };
  await page.route("**/api/preview", async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    await gate;
    await route.fulfill({ json: old });
    delivered = true;
  });
  return { release, held: () => held, delivered: () => delivered };
}

test("changing preview inputs discards the old request and allows a current execution", async ({
  page,
  request,
}) => {
  await openRule(page, request);
  const pending = await holdPreview(page);
  try {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect.poll(pending.held).toBe(true);
    await setEditorText(
      page,
      page.getByLabel("Test input JSON", { exact: true }),
      '{"amount":3}',
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByTestId("test-result")).toHaveText("6");
    pending.release();
    await expect.poll(pending.delivered).toBe(true);
    await expect(page.getByTestId("test-result")).toHaveText("6");
  } finally {
    pending.release();
  }
});

test("closing the preview panel prevents a late response from restoring the graph trace", async ({
  page,
  request,
}) => {
  await openRule(page, request);
  const pending = await holdPreview(page);
  try {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect.poll(pending.held).toBe(true);
    await page
      .getByRole("button", { name: "Close test panel", exact: true })
      .click();
    pending.release();
    await expect.poll(pending.delivered).toBe(true);
    await expect(page.getByText("Execution path highlighted")).toHaveCount(0);
    await expect(page.locator(".node-visited")).toHaveCount(0);
  } finally {
    pending.release();
  }
});

test("trace and timeout controls reach preview and changing options discards a pending trace", async ({
  page,
  request,
}) => {
  await openRule(page, request);
  const pending = await holdPreview(page);
  try {
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect.poll(pending.held).toBe(true);
    await page.getByLabel("Include execution trace", { exact: true }).uncheck();
    await page.getByLabel("Execution timeout", { exact: true }).click();
    await page.getByRole("option", { name: "5 seconds", exact: true }).click();
    const sent = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/preview") &&
        req.postDataJSON().trace === false,
    );
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      trace: false,
      timeoutMs: 5000,
    });
    await expect(page.getByTestId("test-result")).toHaveText("20");
    await expect(
      page.getByText("Trace disabled.", { exact: false }),
    ).toBeVisible();
    await expect(page.locator(".trace-list button")).toHaveCount(0);
    await expect(page.getByTestId("execution-timing")).toContainText("Request");
    await expect(page.getByTestId("execution-timing")).toContainText(
      "Preparation",
    );
    pending.release();
    await expect.poll(pending.delivered).toBe(true);
    await expect(page.locator(".node-visited")).toHaveCount(0);
    await expect(
      page.getByText("Trace disabled.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "cURL", exact: true }).click();
    await expect(page.locator(".curl-preview pre")).toContainText(
      '"trace": false',
    );
    await expect(page.locator(".curl-preview pre")).toContainText(
      '"timeoutMs": 5000',
    );
  } finally {
    pending.release();
  }
});

test("a bounded trace explains incomplete graph highlights without hiding the complete result", async ({
  page,
  request,
}) => {
  await openRule(page, request);
  await page.route("**/api/preview", async (route) => {
    const response = await route.fetch();
    const execution = await response.json();
    await route.fulfill({
      json: {
        ...execution,
        trace: execution.trace.slice(0, 1),
        traceTruncated: true,
      },
    });
  });
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("20");
  await expect(
    page.getByText("Trace size limit reached.", { exact: false }),
  ).toContainText("first 1 of 3 executed steps");
  await expect(page.locator(".trace-list button")).toHaveCount(1);
});

test("published playground loads version details on demand and sends displayed execution options", async ({
  page,
}) => {
  const forbidden: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/rules" || /^\/api\/rules\/[^/]+\/versions$/.test(path))
      forbidden.push(path);
  });
  await page.goto("/#/playground");
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("order-pricing");
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page
    .getByRole("option", { name: "Order pricing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Execute rule", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Include execution trace", { exact: true }).uncheck();
  await expect(page.getByTestId("api-response")).toContainText(
    '"trace": false',
  );
  const sent = page.waitForRequest(
    (req) => req.url().endsWith("/execute") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    version: 1,
    inputs: { orderTotal: 150, customerTier: "premium" },
    trace: false,
    timeoutMs: 30000,
  });
  await expect(page.getByTestId("api-response")).toContainText(
    '"traceEnabled": false',
  );
  await expect(page.getByTestId("api-response")).toContainText('"trace": []');
  await expect(page.getByTestId("api-response")).toContainText('"result": 120');
  await expect(page.getByTestId("execution-timing")).toContainText("Request");
  expect(forbidden).toEqual([]);
});

test("save commands disable all graph mutation actions until the submitted draft returns", async ({
  page,
  request,
}) => {
  const id = await openRule(page, request);
  await page
    .getByRole("button", { name: "Close test panel", exact: true })
    .click();
  await page
    .locator('.react-flow__node[data-id="calculate"] .graph-node')
    .click();
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "amount * 3");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(
      page.getByRole("button", { name: "Add node", exact: true }),
    ).toBeDisabled();
    await setEditorText(page, expression, "amount * 4");
    await expect(editorLines(expression)).toHaveText("amount * 3");
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expect(editorLines(expression)).toHaveText("amount * 3");
  } finally {
    release();
  }
});

test("the playground explains a disabled or truncated trace in the Test panel's words", async ({
  page,
}) => {
  let variant: "truncated" | "disabled" = "truncated";
  await page.route("**/api/rules/*/execute", async (route) => {
    const response = await route.fetch();
    const execution = (await response.json()) as Execution;
    await route.fulfill({
      json:
        variant === "truncated"
          ? {
              ...execution,
              trace: execution.trace.slice(0, 1),
              executedSteps: 3,
              traceTruncated: true,
            }
          : { ...execution, trace: [], traceEnabled: false },
    });
  });
  await page.goto("/#/playground");
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("order-pricing");
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page
    .getByRole("option", { name: "Order pricing", exact: true })
    .click();
  const execute = page.getByRole("button", {
    name: "Execute rule",
    exact: true,
  });
  await expect(execute).toBeEnabled();
  await execute.click();
  // One owner for both surfaces: the wording the Test panel tests assert,
  // without the graph-highlight clause that only the editor adds.
  await expect(
    page.getByText("Trace size limit reached.", { exact: false }),
  ).toHaveText(
    "Trace size limit reached. Showing the first 1 of 3 executed steps. The final result is complete.",
  );
  await page.getByRole("button", { name: "Show cURL request" }).click();
  variant = "disabled";
  await execute.click();
  await expect(page.getByText("Trace disabled.", { exact: false })).toHaveText(
    "Trace disabled. The result includes all executed calculations.",
  );
  await expect(
    page.getByText("Trace size limit reached.", { exact: false }),
  ).toHaveCount(0);
});
