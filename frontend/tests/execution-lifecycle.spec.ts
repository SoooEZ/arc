import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Execution } from "../src/types";

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
  const id = `execution-lifecycle-${Date.now()}`;
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: "Execution lifecycle", kind: "FORMULA", definition },
      })
    ).ok(),
  ).toBe(true);
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
    await page
      .getByLabel("Test input JSON", { exact: true })
      .fill('{"amount":3}');
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
  await page.getByLabel("Expression", { exact: true }).fill("amount * 3");
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
    await expect(page.getByLabel("Expression", { exact: true })).toBeDisabled();
    release();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expect(page.getByLabel("Expression", { exact: true })).toHaveValue(
      "amount * 3",
    );
  } finally {
    release();
  }
});
