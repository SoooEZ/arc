import { setEditorText } from "./helpers/editor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";
import type { Definition, Input, SourceConfig } from "../src/types";

async function openInputRule(
  page: Page,
  request: APIRequestContext,
  id: string,
  inputs: Input[],
) {
  const definition: Definition = {
    schemaVersion: 1,
    inputs,
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: inputs.some((input) => input.name === "amount")
          ? "amount"
          : "7",
        position: { x: 300, y: 200 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "output", sourceHandle: "next" },
    ],
  };
  const created = await request.post("/api/rules", {
    data: { id, name: "Input editing fixture", kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto(`/#/rules/${id}`);
  await page.locator('.react-flow__node[data-id="input"] .graph-node').click();
}

async function expectInvalidDefaultCannotSave(
  page: Page,
  request: APIRequestContext,
  id: string,
) {
  const before = await (await request.get(`/api/rules/${id}`)).json();
  const writes: string[] = [];
  const recordWrite = (outgoing: Request) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().endsWith(`/api/rules/${id}`)
    )
      writes.push(outgoing.url());
  };
  page.on("request", recordWrite);
  try {
    await expect(
      page.getByText("Enter valid JSON before saving", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByText(
        "Fix the invalid JSON default before saving or changing views",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toEqual([]);
    const after = await (await request.get(`/api/rules/${id}`)).json();
    expect(after.revision).toBe(before.revision);
    expect(after.draft).toEqual(before.draft);
  } finally {
    page.off("request", recordWrite);
  }
}

for (const secondDefault of [[], [1]]) {
  test(`removing an invalid input clears only that row's JSON buffer and validity (${JSON.stringify(secondDefault)})`, async ({
    page,
    request,
  }) => {
    const id = `input-row-remove-${Date.now()}`;
    await openInputRule(page, request, id, [
      { name: "first", type: "ARRAY", required: false, defaultValue: [] },
      {
        name: "second",
        type: "ARRAY",
        required: false,
        defaultValue: secondDefault,
      },
    ]);
    await page.getByLabel("Default JSON (optional)").nth(0).fill("[");
    await expectInvalidDefaultCannotSave(page, request, id);
    await page
      .getByRole("button", { name: "Remove first", exact: true })
      .click();
    await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
      JSON.stringify(secondDefault, null, 2),
    );
    await expect(page.getByText("Enter valid JSON before saving")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs).toHaveLength(1);
    expect(saved.draft.inputs[0]).toMatchObject({
      name: "second",
      type: "ARRAY",
      required: false,
      defaultValue: secondDefault,
    });
  });
}

for (const defaultValue of [null, []]) {
  test(`changing structured input type resets its default editor and invalid state (${JSON.stringify(defaultValue)})`, async ({
    page,
    request,
  }) => {
    const id = `input-type-change-${Date.now()}`;
    await openInputRule(page, request, id, [
      { name: "payload", type: "ARRAY", required: false, defaultValue },
    ]);
    await page.getByLabel("Default JSON (optional)").fill("[");
    await expectInvalidDefaultCannotSave(page, request, id);
    await page.getByRole("combobox", { name: "Type", exact: true }).click();
    await page.getByRole("option", { name: "object", exact: true }).click();
    await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
      "null",
    );
    await expect(page.getByText("Enter valid JSON before saving")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs[0]).toMatchObject({
      name: "payload",
      type: "OBJECT",
      defaultValue: null,
    });
  });
}

test("input row identity preserves another row's invalid buffer through deletion and rename", async ({
  page,
  request,
}) => {
  const id = `input-row-retain-${Date.now()}`;
  await openInputRule(page, request, id, [
    { name: "first", type: "ARRAY", required: false, defaultValue: [] },
    { name: "second", type: "ARRAY", required: false, defaultValue: [] },
  ]);
  await page.getByLabel("Default JSON (optional)").nth(1).fill("[unfinished");
  await page.getByRole("button", { name: "Remove first", exact: true }).click();
  await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
    "[unfinished",
  );
  await page.getByLabel("Parameter name", { exact: true }).fill("renamed");
  await expect(
    page.getByLabel("Parameter name", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
    "[unfinished",
  );
  await expectInvalidDefaultCannotSave(page, request, id);
  await page.getByLabel("Default JSON (optional)").fill("[3]");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs).toHaveLength(1);
  expect(saved.draft.inputs[0]).toMatchObject({
    name: "renamed",
    type: "ARRAY",
    defaultValue: [3],
  });
});

test("changing a pinned source version removes obsolete mappings and retains compatible mappings", async ({
  page,
  request,
}) => {
  const sourceId = `source-contract-${Date.now()}`;
  const configuration: SourceConfig = {
    kind: "HTTP",
    timeoutMs: 3000,
    url: "https://example.com/customer",
    parameters: [
      { name: "key", type: "STRING", required: true, defaultValue: null },
      {
        name: "customerId",
        type: "STRING",
        required: true,
        defaultValue: null,
      },
    ],
  };
  const created = await request.post("/api/sources", {
    data: {
      id: sourceId,
      name: "Evolving contract",
      definition: configuration,
    },
  });
  expect(created.ok()).toBeTruthy();
  const revised = await request.put(`/api/sources/${sourceId}`, {
    data: {
      name: "Evolving contract",
      revision: 1,
      definition: {
        ...configuration,
        parameters: configuration.parameters.map((parameter) =>
          parameter.name === "customerId"
            ? { ...parameter, name: "accountId" }
            : parameter,
        ),
      },
    },
  });
  expect(revised.ok()).toBeTruthy();
  const ruleId = `source-version-mapping-${Date.now()}`;
  await openInputRule(page, request, ruleId, [
    {
      name: "amount",
      type: "NUMBER",
      required: true,
      defaultValue: null,
      source: {
        id: sourceId,
        version: 1,
        pointer: "",
        onError: "FAIL",
        bindings: { key: '"US"', customerId: '"customer-1"' },
      },
    },
  ]);
  await expect(
    page.getByLabel("Source customerId", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Source version", exact: true })
    .click();
  await page.getByRole("option", { name: "v2", exact: true }).click();
  await expect(
    page.getByLabel("Source customerId", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Source key", { exact: true })).toHaveValue(
    "US",
  );
  await page
    .getByRole("combobox", {
      name: "Source accountId · value source",
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "Constant", exact: true }).click();
  await page.getByLabel("Source accountId", { exact: true }).fill("account-1");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  // Caller override keeps this contract regression independent of external HTTP services.
  await setEditorText(
    page,
    page.getByLabel("Test input JSON", { exact: true }),
    '{"amount":7}',
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("7");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await (await request.get(`/api/rules/${ruleId}`)).json();
  expect(saved.draft.inputs[0].source).toMatchObject({
    version: 2,
    bindings: { key: '"US"', accountId: '"account-1"' },
  });
  expect(saved.draft.inputs[0].source.bindings).not.toHaveProperty(
    "customerId",
  );
});
