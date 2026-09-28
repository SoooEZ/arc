import { expect, test } from "@playwright/test";
import { createRule, uniqueStamp } from "./helpers/api";

test("source parameters named like Object members can be mapped and saved", async ({
  page,
  request,
}) => {
  const stamp = uniqueStamp();
  const sourceId = `member-names-${stamp}`;
  const optional = (name: string) => ({
    name,
    type: "STRING",
    required: false,
    defaultValue: null,
  });
  const source = await request.post("/api/sources", {
    data: {
      id: sourceId,
      name: `Member names ${stamp}`,
      definition: {
        kind: "HTTP",
        url: "https://example.com/customer",
        parameters: [
          optional("constructor"),
          optional("toString"),
          optional("__proto__"),
        ],
        secretHeaders: {},
        timeoutMs: 3000,
      },
    },
  });
  expect(source.ok(), await source.text()).toBeTruthy();
  const ruleId = `member-bindings-${stamp}`;
  await createRule(request, {
    id: ruleId,
    name: ruleId,
    kind: "FORMULA",
    definition: {
      schemaVersion: 1,
      inputs: [
        {
          name: "amount",
          type: "STRING",
          required: false,
          defaultValue: null,
          source: {
            id: sourceId,
            version: 1,
            bindings: {},
            pointer: "",
            onError: "FAIL",
          },
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
          id: "out",
          type: "OUTPUT",
          label: "Result",
          expression: "amount",
          position: { x: 200, y: 200 },
        },
      ],
      edges: [
        { id: "next", source: "input", target: "out", sourceHandle: "next" },
      ],
    },
  });
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto(`/#/rules/${ruleId}?node=input`);

  // Unmapped parameters read as missing (no upstream variable chosen yet), not
  // as inherited Object members.
  for (const name of ["constructor", "toString", "__proto__"])
    await expect(
      page.getByLabel(`Source ${name} · value source`, { exact: true }),
    ).toHaveText("Upstream variable");
  for (const [name, value] of [
    ["constructor", "US"],
    ["__proto__", "GB"],
  ]) {
    await page
      .getByLabel(`Source ${name} · value source`, { exact: true })
      .click();
    await page.getByRole("option", { name: "Constant", exact: true }).click();
    await page.getByLabel(`Source ${name}`, { exact: true }).fill(value);
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  const saved = await (await request.get(`/api/rules/${ruleId}`)).text();
  const bindings = JSON.parse(saved).draft.inputs[0].source.bindings;
  expect(Object.keys(bindings).sort()).toEqual(["__proto__", "constructor"]);
  expect(bindings.constructor).toBe('"US"');
  expect(Object.getOwnPropertyDescriptor(bindings, "__proto__")?.value).toBe(
    '"GB"',
  );

  await page.reload();
  await expect(
    page.getByLabel("Source __proto__", { exact: true }),
  ).toHaveValue("GB");
  await expect(
    page.getByLabel("Source constructor", { exact: true }),
  ).toHaveValue("US");
  expect(crashes).toEqual([]);
});

test("a mapping for a parameter the pinned source version does not declare is named and removable", async ({
  page,
  request,
}) => {
  const stamp = uniqueStamp();
  const sourceId = `undeclared-${stamp}`;
  const source = await request.post("/api/sources", {
    data: {
      id: sourceId,
      name: `Undeclared ${stamp}`,
      definition: {
        kind: "LOOKUP",
        parameters: [
          { name: "key", type: "STRING", required: true, defaultValue: null },
        ],
        entries: { GB: 20, US: 10 },
        timeoutMs: 3000,
      },
    },
  });
  expect(source.ok(), await source.text()).toBeTruthy();
  const ruleId = `undeclared-binding-${stamp}`;
  await createRule(request, {
    id: ruleId,
    name: ruleId,
    kind: "FORMULA",
    definition: {
      schemaVersion: 1,
      inputs: [
        {
          name: "amount",
          type: "NUMBER",
          required: false,
          defaultValue: null,
          source: {
            id: sourceId,
            version: 1,
            // A mapping saved before the pin changed, or by an API client.
            bindings: { key: '"GB"', region: '"US"' },
            pointer: "/rate",
            onError: "FAIL",
          },
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
          id: "out",
          type: "OUTPUT",
          label: "Result",
          expression: "amount",
          position: { x: 200, y: 200 },
        },
      ],
      edges: [
        { id: "next", source: "input", target: "out", sourceHandle: "next" },
      ],
    },
  });
  await page.goto(`/#/rules/${ruleId}?node=input`);
  const nodeErrors = page.getByRole("button", { name: /^Node errors/ });
  await expect(nodeErrors).toBeVisible();
  // The mapping was invisible: the cards show declared parameters only.
  const alert = page.getByRole("alert").filter({ hasText: "Also maps region" });
  await expect(alert).toContainText(
    `which v1 of Undeclared ${stamp} does not declare`,
  );
  await alert.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByLabel("Source key", { exact: true })).toHaveValue(
    "GB",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(nodeErrors).toHaveCount(0);
  const saved = JSON.parse(
    await (await request.get(`/api/rules/${ruleId}`)).text(),
  );
  expect(saved.draft.inputs[0].source).toEqual({
    id: sourceId,
    version: 1,
    bindings: { key: '"GB"' },
    pointer: "/rate",
    onError: "FAIL",
  });
});
