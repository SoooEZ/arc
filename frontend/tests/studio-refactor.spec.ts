import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "10",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

async function createRule(
  request: APIRequestContext,
  id: string,
  name: string,
  publish = false,
) {
  const response = await request.post("/api/rules", {
    data: { id, name, kind: "FORMULA", definition },
  });
  expect(response.ok()).toBeTruthy();
  const rule: Rule = await response.json();
  if (publish) {
    const published = await request.post(`/api/rules/${id}/publish`, {
      data: { revision: rule.revision },
    });
    expect(published.ok()).toBeTruthy();
  }
}

test("reused rule names remain literal while Monaco placeholders remain editable", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const child = `snippet-literal-child-${suffix}`;
  const parent = `snippet-literal-parent-${suffix}`;
  const name = "Discount $100 \\ tier ${1:literal} " + suffix;
  await createRule(request, child, name, true);
  await createRule(request, parent, `Snippet literal caller ${suffix}`);

  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .getByRole("button", { name: `${name} v1 · formula +`, exact: true })
    .click();
  await expect(page.locator(".view-lines")).toContainText("reusedResult");
  // The inserted reference retains its result/target tab stops after literal escaping.
  await page.keyboard.insertText("childResult");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("out");
  await page.keyboard.press("Escape");
  const build = page.waitForRequest(
    (outgoing) =>
      outgoing.method() === "POST" &&
      outgoing.url().endsWith("/api/studio/build"),
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  const source = (await build).postDataJSON().source as string;
  expect(source).toContain(`REFERENCE ${JSON.stringify(name)}`);
  expect(source).toContain("as childResult;");
  expect(source).toContain('next -> "out";');
});

test("a late reuse response cannot insert into a newly mounted code editor", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const child = `snippet-late-child-${suffix}`;
  const parent = `snippet-late-parent-${suffix}`;
  const name = `Delayed reusable rule ${suffix}`;
  await createRule(request, child, name, true);
  await createRule(request, parent, `Late snippet caller ${suffix}`);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`**/api/rules/${child}/versions/1`, async (route) => {
    started();
    await blocked;
    await route.continue();
  });

  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .getByRole("button", {
      name: `${name} v1 · formula +`,
      exact: true,
    })
    .click();
  await requested;
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  release();
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText("return 10;");
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  await expect(page.getByText("Code built. Graph is valid.")).toBeVisible();
  await expect(page.locator(".view-lines")).not.toContainText("REFERENCE");
});
