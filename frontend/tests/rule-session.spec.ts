import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: false, defaultValue: 1 },
  ],
  nodes: [
    {
      id: "input",
      type: "INPUT",
      label: "Inputs",
      position: { x: 250, y: 0 },
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount",
      position: { x: 250, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

test("reopening a saved rule waits for a fresh detail read and uses its latest revision", async ({
  page,
  request,
}) => {
  const id = uniqueId("rule-session");
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}?node=input`);
  await page.getByLabel("Default value (optional)").fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  const previous: Rule = await (await request.get(`/api/rules/${id}`)).json();
  const updatedResponse = await request.put(`/api/rules/${id}`, {
    data: {
      name: previous.name,
      description: previous.description,
      revision: previous.revision,
      definition: {
        ...previous.draft,
        inputs: [{ ...previous.draft.inputs[0], defaultValue: 9 }],
      },
    },
  });
  expect(updatedResponse.ok()).toBeTruthy();
  const updated: Rule = await updatedResponse.json();
  let releaseFailure!: () => void;
  let releaseRead!: () => void;
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let reads = 0;
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    if (reads === 1) {
      await failureGate;
      await route.fulfill({
        status: 503,
        json: { message: "Temporarily unavailable" },
      });
    } else {
      await readGate;
      await route.continue();
    }
  });
  try {
    await page.evaluate((ruleId) => {
      window.location.hash = `/rules/${ruleId}?node=input`;
    }, id);
    await expect.poll(() => reads).toBe(1);
    await expect(
      page.getByText("Loading rule…", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    releaseFailure();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Could not load rule: Temporarily unavailable" }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry rule", exact: true }).click();
    await expect.poll(() => reads).toBe(2);
    await expect(
      page.getByText("Loading rule…", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    releaseRead();
    await expect(page.getByLabel("Default value (optional)")).toHaveValue("9");
    await page.getByLabel("Default value (optional)").fill("10");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/rules/${id}`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const response = await saved;
    expect(response.request().postDataJSON().revision).toBe(updated.revision);
    expect(response.ok()).toBeTruthy();
    const current: Rule = await response.json();
    expect(current.draft.inputs[0].defaultValue).toBe(10);
    expect(current.revision).toBeGreaterThan(updated.revision);
  } finally {
    releaseFailure();
    releaseRead();
  }
});

test("returning from a published version refreshes the draft while graph/code switches preserve edits", async ({
  page,
  request,
}) => {
  const id = uniqueId("rule-version-session");
  await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}?node=input`);
  await page.getByLabel("Default value (optional)").fill("2");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}?version=1&node=input`;
  }, id);
  await expect(page.getByText("Immutable published version")).toBeVisible();
  await expect(page.getByLabel("Default value (optional)")).toHaveValue("2");

  const previous: Rule = await (await request.get(`/api/rules/${id}`)).json();
  const updatedResponse = await request.put(`/api/rules/${id}`, {
    data: {
      name: previous.name,
      description: previous.description,
      revision: previous.revision,
      definition: {
        ...previous.draft,
        inputs: [{ ...previous.draft.inputs[0], defaultValue: 9 }],
      },
    },
  });
  expect(updatedResponse.ok()).toBeTruthy();
  const updated: Rule = await updatedResponse.json();
  let releaseRead!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let detailReads = 0;
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    detailReads++;
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect.poll(() => detailReads).toBe(1);
    await expect(
      page.getByText("Loading rule…", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    releaseRead();
    await page
      .locator('.react-flow__node[data-id="input"] .graph-node')
      .click();
    await expect(page.getByLabel("Default value (optional)")).toHaveValue("9");
    await page.getByLabel("Default value (optional)").fill("10");
    await page
      .getByRole("button", { name: "Code editor", exact: true })
      .click();
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.getByRole("button", { name: "Graph view", exact: true }).click();
    await page
      .locator('.react-flow__node[data-id="input"] .graph-node')
      .click();
    await expect(page.getByLabel("Default value (optional)")).toHaveValue("10");
    expect(detailReads).toBe(1);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/rules/${id}`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const response = await saved;
    expect(response.request().postDataJSON().revision).toBe(updated.revision);
    expect(response.ok()).toBeTruthy();
    const current: Rule = await response.json();
    expect(current.draft.inputs[0].defaultValue).toBe(10);
    expect(current.revision).toBeGreaterThan(updated.revision);
  } finally {
    releaseRead();
  }
});

test("a saved copy never stands in for a rule created again under the same ID", async ({
  page,
  request,
}) => {
  const id = uniqueId("rule-session-recreated");
  await createRule(request, {
    id,
    name: "Mine",
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}?node=input`);
  await page.getByLabel("Default value (optional)").fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const mine: Rule = await (await request.get(`/api/rules/${id}`)).json();
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: "Rule library", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  // Someone deleted the rule and created another under the same ID. Its
  // revision is lower than the saved copy's, so only the identity can tell.
  const theirs: Rule = {
    ...mine,
    name: "Someone else's rule",
    revision: 1,
    createdAt: "2030-01-01T00:00:00Z",
    draft: {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "out" ? { ...node, label: "Their result" } : node,
      ),
    },
  };
  await page.route(`**/api/rules/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: theirs });
  });
  await page.evaluate((ruleId) => {
    window.location.hash = `/rules/${ruleId}`;
  }, id);
  await expect(
    page.getByRole("heading", { name: "Someone else's rule", exact: true }),
  ).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="out"]')).toContainText(
    "Their result",
  );
});
