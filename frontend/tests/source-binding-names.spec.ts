import { expect, test } from "@playwright/test";

test("source parameters named like Object members can be mapped and saved", async ({
  page,
  request,
}) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const rule = await request.post("/api/rules", {
    data: {
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
    },
  });
  expect(rule.ok(), await rule.text()).toBeTruthy();
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
