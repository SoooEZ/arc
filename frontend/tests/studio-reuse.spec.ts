import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Build, Definition } from "../src/types";
import { createRule, publishRule, uniqueStamp } from "./helpers/api";
import { editorLines } from "./helpers/editor";
import { deferred } from "./helpers/gates";

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

async function createReuseRule(
  request: APIRequestContext,
  id: string,
  name: string,
  publish = false,
) {
  const rule = await createRule(request, { id, name, definition });
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
  await createReuseRule(request, child, name, true);
  await createReuseRule(request, parent, `Long reuse caller ${suffix}`);

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
  await createReuseRule(request, child, name, true);
  await createReuseRule(request, parent, `Reuse once caller ${suffix}`);
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
  await createReuseRule(request, id, `Double insert ${suffix}`);
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
  await createReuseRule(request, first, `Reuse names A ${suffix}`, true);
  await createReuseRule(request, second, `Reuse names B ${suffix}`, true);
  await createReuseRule(request, parent, `Reuse names caller ${suffix}`);
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
  await createReuseRule(request, child, `Discount ${suffix}`, true);
  await createReuseRule(request, parent, `Reuse search caller ${suffix}`);
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
  const { promise: held, release } = deferred();
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

// The pane dropped the edited rule from its cards but paged the server's
// totals: once published, searching its own name showed "1–1 of 1" over no
// cards, and a page could end with no cards at all. A result that fits on one
// page now shows no pager, so the card itself is what the search shows.
test("the Reuse pane shows the edited rule's own card disabled", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const parent = `reuse-self-${suffix}`;
  const name = `Reuse self ${suffix}`;
  await createReuseRule(request, parent, name, true);
  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page.getByLabel("Find reusable rule").fill(name);
  const card = page.getByRole("button", {
    name: `${name} v1 · formula · this rule +`,
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card).toBeDisabled();
  await expect(page.locator(".studio-library .snippet-card")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Reusable rules pages" }),
  ).toHaveCount(0);
});

test("a Reuse search that matches nothing says so instead of an empty list", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const parent = `reuse-none-${suffix}`;
  await createReuseRule(request, parent, `Reuse none ${suffix}`);
  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page.getByLabel("Find reusable rule").fill(`nothing-${suffix}`);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `No published rule matches “nothing-${suffix}”.` }),
  ).toBeVisible();
  await expect(page.locator(".studio-library .snippet-card")).toHaveCount(0);
});

test("reused rule names remain literal while Monaco placeholders remain editable", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const child = `snippet-literal-child-${suffix}`;
  const parent = `snippet-literal-parent-${suffix}`;
  const name = "Discount $100 \\ tier ${1:literal} " + suffix;
  await createReuseRule(request, child, name, true);
  await createReuseRule(request, parent, `Snippet literal caller ${suffix}`);

  await page.goto(`/#/studio/${parent}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .getByRole("button", { name: `${name} v1 · formula +`, exact: true })
    .click();
  await expect(page.locator(".view-lines")).toContainText("result_1");
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
  const suffix = uniqueStamp();
  const child = `snippet-late-child-${suffix}`;
  const parent = `snippet-late-parent-${suffix}`;
  const name = `Delayed reusable rule ${suffix}`;
  await createReuseRule(request, child, name, true);
  await createReuseRule(request, parent, `Late snippet caller ${suffix}`);
  const { promise: blocked, release } = deferred();
  const { promise: requested, release: started } = deferred();
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

test("a reuse insertion is refused when the code changed while the rule loaded", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const child = `snippet-stale-child-${suffix}`;
  const parent = `snippet-stale-parent-${suffix}`;
  const name = `Stale reusable rule ${suffix}`;
  await createReuseRule(request, child, name, true);
  await createReuseRule(request, parent, `Stale snippet caller ${suffix}`);
  const { promise: blocked, release } = deferred();
  const { promise: requested, release: started } = deferred();
  await page.route(`**/api/rules/${child}/versions/1`, async (route) => {
    started();
    await blocked;
    await route.continue();
  });

  await page.goto(`/#/studio/${parent}`);
  const editor = page.getByLabel("ARC code editor", { exact: true });
  await expect(editorLines(editor)).toContainText("return 10;");
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .getByRole("button", { name: `${name} v1 · formula +`, exact: true })
    .click();
  await requested;
  // Typing while the pinned version loads: the late snippet used to land after it.
  await page.locator(".view-line", { hasText: "return 10;" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // note");
  release();
  await expect(
    page.locator(".studio-library").getByRole("alert"),
  ).toContainText(
    "The code changed while the rule loaded. Choose the rule again.",
  );
  await expect(editorLines(editor)).toContainText("return 10; // note");
  await expect(editorLines(editor)).not.toContainText("REFERENCE");
  await page.keyboard.type("d");
  await expect(editorLines(editor)).toContainText("return 10; // noted");
});
