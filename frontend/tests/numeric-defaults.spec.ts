import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";

/** The stored draft as raw JSON text: parsing it into doubles would hide rounding. */
async function storedDraft(request: APIRequestContext, id: string) {
  return (await request.get(`/api/rules/${id}`)).text();
}

async function openNumericRule(page: Page, request: APIRequestContext) {
  const id = `numeric-default-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: false, defaultValue: 7 },
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
    edges: [
      { id: "next", source: "input", target: "out", sourceHandle: "next" },
    ],
  };
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto(`/#/rules/${id}?node=input`);
  await expect(page.getByLabel("Default value (optional)")).toHaveValue("7");
  return { id, original: (await created.json()) as Rule };
}

function watchWrites(page: Page, id: string) {
  const writes: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().endsWith(`/api/rules/${id}`)
    )
      writes.push(outgoing.postData() ?? "");
  });
  return writes;
}

test("an unsupported numeric default retains its raw text, blocks writes and can be corrected", async ({
  page,
  request,
}) => {
  const { id, original } = await openNumericRule(page, request);
  const field = page.getByLabel("Default value (optional)");
  const writes = watchWrites(page, id);
  await field.fill("1e400");
  await expect(field).toHaveValue("1e400");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText(
      "This number is too large or too precise. Use at most 100 digits and 100 decimal places.",
    ),
  ).toBeVisible();
  await page.getByLabel("Parameter name", { exact: true }).fill("renamed");
  await expect(field).toHaveValue("1e400");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText(
      "Fix the invalid parameter default before saving or changing views",
      { exact: true },
    ),
  ).toBeVisible();
  expect(writes).toEqual([]);
  const unchanged: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(unchanged.revision).toBe(original.revision);
  expect(unchanged.draft).toEqual(original.draft);

  await field.fill("9007199254740992");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0])).toMatchObject({
    definition: {
      inputs: [{ name: "renamed", defaultValue: 9007199254740992 }],
    },
  });
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].defaultValue).toBe(9007199254740992);
});

test("a numeric default that a double would round saves and reloads with every digit", async ({
  page,
  request,
}) => {
  const { id } = await openNumericRule(page, request);
  const field = page.getByLabel("Default value (optional)");
  const writes = watchWrites(page, id);
  await field.fill("9007199254740993");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("Parameter name", { exact: true }).fill("limit");
  await expect(field).toHaveValue("9007199254740993");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain('"defaultValue":9007199254740993');
  expect(await storedDraft(request, id)).toContain(
    '"name":"limit","type":"NUMBER","required":false,"defaultValue":9007199254740993',
  );

  // A decimal with more digits than a double carries keeps them as typed.
  await field.fill("0.10000000000000000000001");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(writes[1]).toContain('"defaultValue":0.10000000000000000000001');
  await page.reload();
  await expect(page.getByLabel("Default value (optional)")).toHaveValue(
    "0.10000000000000000000001",
  );
});

test("decimal and scientific defaults keep their edit text and save their numeric value", async ({
  page,
  request,
}) => {
  const { id } = await openNumericRule(page, request);
  const field = page.getByLabel("Default value (optional)");
  for (const [text, value] of [
    ["0.1000", 0.1],
    ["1.2500e+3", 1250],
  ] as const) {
    await field.fill(text);
    await page.getByLabel("Parameter name", { exact: true }).focus();
    await expect(field).toHaveValue(text);
    await expect(field).toHaveAttribute("aria-invalid", "false");
    const response = page.waitForResponse(
      (incoming) =>
        incoming.request().method() === "PUT" &&
        incoming.url().endsWith(`/api/rules/${id}`),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    expect((await response).ok()).toBeTruthy();
    const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs[0].defaultValue).toBe(value);
  }
});

test("incomplete numeric defaults survive typing and reset validity when the type changes", async ({
  page,
  request,
}) => {
  const { id } = await openNumericRule(page, request);
  const field = page.getByLabel("Default value (optional)");
  await field.fill("1e");
  await expect(field).toHaveValue("1e");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("combobox", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await expect(field).toHaveValue("");
  await field.fill("1e");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0]).toMatchObject({
    type: "STRING",
    defaultValue: "1e",
  });
});

test("the staged Input editor blocks unsupported defaults, cancels without changing the parent and applies exact values", async ({
  page,
  request,
}) => {
  const { id } = await openNumericRule(page, request);
  const input = page.locator('.react-flow__node[data-id="input"] .graph-node');
  await input.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit node · Inputs",
    exact: true,
  });
  await dialog.getByLabel("Default value (optional)").fill("1e-400");
  await expect(
    dialog.getByRole("button", { name: "Apply to graph", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Default value (optional)")).toHaveValue("7");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await input.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Default value (optional)")).toHaveValue("7");
  await dialog.getByLabel("Default value (optional)").fill("0.1250");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].defaultValue).toBe(0.125);

  await input.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Default value (optional)").fill("-9007199254740993");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(page.getByLabel("Default value (optional)")).toHaveValue(
    "-9007199254740993",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(await storedDraft(request, id)).toContain(
    '"defaultValue":-9007199254740993',
  );
});
