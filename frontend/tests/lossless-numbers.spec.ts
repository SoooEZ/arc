import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

// Numbers that a JavaScript double would round. Assertions read raw request and
// response text, because parsing them in the test would round them as well.
const beyondDouble = "9007199254740993";
const longInteger = "12345678901234567890";
const longDecimal = "0.07000000000000000001";

/** Creates a rule from raw JSON so that exact number tokens reach the server. */
async function createRule(
  request: APIRequestContext,
  id: string,
  definition: string,
) {
  const created = await request.post("/api/rules", {
    headers: { "Content-Type": "application/json" },
    data: `{"id":"${id}","name":"${id}","kind":"FORMULA","definition":${definition}}`,
  });
  expect(created.ok()).toBe(true);
}

/** An Input and one Output; `{{exact}}` in the JSON is replaced by a raw number token. */
function outputRule(
  expression: string,
  inputs: Definition["inputs"] = [],
  exact = "",
) {
  const definition: Definition = {
    schemaVersion: 1,
    inputs,
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression,
        position: { x: 0, y: 200 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "out", sourceHandle: "next" },
    ],
  };
  return JSON.stringify(definition).replace('"{{exact}}"', exact);
}

function putBodies(page: Page, path: string) {
  const bodies: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() === "PUT" && outgoing.url().endsWith(path))
      bodies.push(outgoing.postData() ?? "");
  });
  return bodies;
}

test("Code studio saves a default that a double would round with every digit", async ({
  page,
  request,
}) => {
  const id = `exact-studio-${Date.now()}`;
  await createRule(request, id, outputRule("1"));
  const puts = putBodies(page, `/api/rules/${id}`);
  await page.goto(`/#/studio/${id}`);
  const code = page.getByLabel("ARC code editor", { exact: true });
  await expect(editorLines(code)).toContainText("return 1;");
  await setEditorText(
    page,
    code,
    `schema 1;
inputs {
  id: NUMBER required default ${beyondDouble};
}
node input INPUT "Inputs" { next -> out; }
node out OUTPUT "Result" { return id; }
`,
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toContain(`"defaultValue":${beyondDouble}`);
  expect(await (await request.get(`/api/rules/${id}`)).text()).toContain(
    `"defaultValue":${beyondDouble}`,
  );
  await page.reload();
  await expect(editorLines(code)).toContainText(`default ${beyondDouble};`);
});

test("an API-created lookup source saves a new version without rounding its entries", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const id = `exact-lookup-${stamp}`;
  const name = `Exact lookup ${stamp}`;
  const entries = `{"US":{"accountId":${longInteger},"rate":${longDecimal},"limit":${beyondDouble}}}`;
  const created = await request.post("/api/sources", {
    headers: { "Content-Type": "application/json" },
    data: `{"id":"${id}","name":"${name}","definition":{"kind":"LOOKUP","parameters":[{"name":"key","type":"STRING","required":true,"defaultValue":null}],"entries":${entries},"timeoutMs":3000}}`,
  });
  expect(created.ok()).toBe(true);
  const puts = putBodies(page, `/api/sources/${id}`);
  await page.goto("/#/sources");
  await page.getByLabel("Search data sources", { exact: true }).fill(name);
  await page.locator(".source-list > button").filter({ hasText: name }).click();
  await expect(page.getByLabel("Source ID", { exact: true })).toHaveValue(id);
  const shown = await page
    .getByLabel("Lookup entries · JSON object", { exact: true })
    .inputValue();
  for (const token of [longInteger, longDecimal, beyondDouble])
    expect(shown).toContain(token);

  await page.getByLabel("Name", { exact: true }).fill(`${name} renamed`);
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByRole("combobox", { name: "Inspect version", exact: true }),
  ).toHaveText("v2 · latest");
  expect(puts).toHaveLength(1);
  const saved = await (
    await request.get(`/api/sources/${id}/versions/2`)
  ).text();
  // The server stores entries as JSONB, which orders object keys its own way.
  for (const field of [
    `"accountId":${longInteger}`,
    `"rate":${longDecimal}`,
    `"limit":${beyondDouble}`,
  ]) {
    expect(puts[0]).toContain(field);
    expect(saved).toContain(field);
  }
});

test("preview sends exact inputs and shows every digit of defaults and results", async ({
  page,
  request,
}) => {
  const id = `exact-preview-${Date.now()}`;
  await createRule(
    request,
    id,
    outputRule(
      '$OBJECT("id", id, "limit", limit, "third", 10 / 3)',
      [
        { name: "id", type: "NUMBER", required: true, defaultValue: null },
        {
          name: "limit",
          type: "NUMBER",
          required: false,
          defaultValue: "{{exact}}",
        },
      ],
      longInteger,
    ),
  );
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  const input = page.getByLabel("Test input JSON", { exact: true });
  await expect(editorLines(input)).toContainText(`"limit": ${longInteger}`);
  await setEditorText(
    page,
    input,
    `{"id": ${beyondDouble}, "limit": ${longInteger}}`,
  );
  const sent = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/preview"),
  );
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  expect((await sent).postData()).toContain(
    `"inputs":{"id":${beyondDouble},"limit":${longInteger}}`,
  );
  await expect(page.getByTestId("test-result")).toHaveText(
    `{"id":${beyondDouble},"limit":${longInteger},"third":3.333333333333333333333333333333333}`,
  );
});
