import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Build, Definition, Rule } from "../src/types";

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

test("reusing a rule with an 80-character ID inserts a node ID that builds", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const child = `reuse-limit-child-${suffix}-`.padEnd(80, "x");
  const parent = `reuse-limit-parent-${suffix}`;
  const name = `Long reusable rule ${suffix}`;
  expect(child).toHaveLength(80);
  await createRule(request, child, name, true);
  await createRule(request, parent, `Long reuse caller ${suffix}`);

  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .getByRole("button", { name: `${name} v1 · formula +`, exact: true })
    .click();
  await expect(page.locator(".view-lines")).toContainText("result_1");
  await page.keyboard.insertText("childResult");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("out");
  await page.keyboard.press("Escape");
  const built = page.waitForResponse((response) =>
    response.url().endsWith("/api/studio/build"),
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  const build: Build = await (await built).json();
  expect(build.diagnostics.map((problem) => problem.message)).not.toContain(
    "Every node needs a valid ID",
  );
  const reused = build.definition?.nodes.find(
    (node) => node.type === "REFERENCE",
  );
  expect(reused?.ruleId).toBe(child);
  expect(reused?.id).toMatch(/^reuse-reuse-limit-child-[A-Za-z0-9_-]+$/);
  expect(reused?.id.length).toBeLessThanOrEqual(80);
});

test("the repeated click of a double click never inserts a second Reference node", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const child = `reuse-once-child-${suffix}`;
  const parent = `reuse-once-parent-${suffix}`;
  const name = `Reuse once ${suffix}`;
  await createRule(request, child, name, true);
  await createRule(request, parent, `Reuse once caller ${suffix}`);
  let started = 0;
  let settled = 0;
  const isVersionRead = (url: string) =>
    url.endsWith(`/api/rules/${child}/versions/1`);
  page.on("request", (outgoing) => {
    if (isVersionRead(outgoing.url())) started += 1;
  });
  for (const event of ["requestfinished", "requestfailed"] as const)
    page.on(event, (outgoing) => {
      if (isVersionRead(outgoing.url())) settled += 1;
    });

  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  const card = page.getByRole("button", {
    name: `${name} v1 · formula +`,
    exact: true,
  });
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(".view-lines")).toContainText("result_1");
  await expect.poll(() => started > 0 && started === settled).toBe(true);
  // The second click arrives once the first read has answered, so aborting a
  // pending read protects nothing; only the click count tells the two apart.
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.keyboard.press("Escape");
  const build = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/studio/build"),
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  const source = (await build).postDataJSON().source as string;
  expect(source.match(/ REFERENCE /g)).toHaveLength(1);
  expect(started).toBe(1);
});

test("each inserted Reuse card gets its own result name", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const first = `reuse-names-a-${suffix}`;
  const second = `reuse-names-b-${suffix}`;
  const parent = `reuse-names-parent-${suffix}`;
  await createRule(request, first, `Reuse names A ${suffix}`, true);
  await createRule(request, second, `Reuse names B ${suffix}`, true);
  await createRule(request, parent, `Reuse names caller ${suffix}`);
  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  const insert = async (name: string, result: string) => {
    await page
      .getByRole("button", { name: `${name} v1 · formula +`, exact: true })
      .click();
    await expect(page.locator(".view-lines")).toContainText(`as ${result};`);
    await page.keyboard.press("Tab");
    await page.keyboard.type("out");
    await page.keyboard.press("Escape");
  };
  await insert(`Reuse names A ${suffix}`, "result_1");
  // Both snippets named their result reusedResult, and the second overwrote the first.
  await insert(`Reuse names B ${suffix}`, "result_2");
  const built = page.waitForResponse((response) =>
    response.url().endsWith("/api/studio/build"),
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  const build: Build = await (await built).json();
  expect(
    build.definition?.nodes
      .filter((node) => node.type === "REFERENCE")
      .map((node) => node.output),
  ).toEqual(["result_1", "result_2"]);
});
