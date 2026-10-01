import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Build, Definition } from "../src/types";
import {
  createRule as createApiRule,
  publishRule,
  uniqueStamp,
} from "./helpers/api";

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
  const rule = await createApiRule(request, { id, name, definition });
  if (publish) await publishRule(request, rule);
}

test("reusing a rule with an 80-character ID inserts a node ID that builds", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
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
  const suffix = uniqueStamp();
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
  page.on("requestfinished", (outgoing) => {
    if (isVersionRead(outgoing.url())) settled += 1;
  });
  page.on("requestfailed", (outgoing) => {
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

// Cards that insert at once took both clicks of a double click: a Switch
// module twice (a duplicate node ID) and $ROUND nested in itself.
test("a double click on a module or a function inserts it once", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const id = `double-insert-${suffix}`;
  await createRule(request, id, `Double insert ${suffix}`);
  await page.goto(`/#/studio/${id}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "modules", exact: true }).click();
  await page
    .getByRole("button", { name: "Switch cases +", exact: true })
    .dblclick();
  await page.getByRole("button", { name: "functions", exact: true }).click();
  await page.getByPlaceholder("Search functions…").fill("ROUND");
  await page.getByRole("button", { name: "$ROUND", exact: true }).dblclick();
  const build = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/studio/build"),
  );
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  const source = (await build).postDataJSON().source as string;
  expect(source.match(/ SWITCH /g)).toHaveLength(1);
  expect(source.match(/\$ROUND\(/g)).toHaveLength(1);
});

test("each inserted Reuse card gets its own result name", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
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

test("the Reuse search waits for a pause in typing and keeps its cards until the answer", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const child = `reuse-search-child-${suffix}`;
  const parent = `reuse-search-parent-${suffix}`;
  await createRule(request, child, `Discount ${suffix}`, true);
  await createRule(request, parent, `Reuse search caller ${suffix}`);
  const searches: string[] = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      url.pathname === "/api/rule-summaries" &&
      url.searchParams.get("publishedOnly") === "true" &&
      url.searchParams.get("search")
    )
      searches.push(url.searchParams.get("search")!);
  });
  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  const card = page.getByRole("button", {
    name: `Discount ${suffix} v1 · formula +`,
    exact: true,
  });
  await expect(card).toBeVisible();
  // Every keystroke sent a search and blanked the list; the settled text sends one.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rule-summaries?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("search") === suffix) await held;
    await route.fallback();
  });
  // The suffix names only this test's rules; typing it sent one request per key.
  await page
    .getByLabel("Find reusable rule")
    .pressSequentially(suffix, { delay: 40 });
  await expect.poll(() => searches.at(-1)).toBe(suffix);
  // The settled text sends one request; a slow development build may let a
  // few keystrokes settle on their own, never every one of them.
  expect(searches.length, JSON.stringify(searches)).toBeLessThan(suffix.length);
  await expect(card).toBeVisible();
  release();
  await expect(card).toBeVisible();
  await expect
    .poll(() => page.getByRole("button", { name: / v1 · formula \+$/ }).count())
    .toBe(1);
  expect(searches.length).toBeLessThan(suffix.length);
});
