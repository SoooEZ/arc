import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition } from "../src/types";
import {
  createRule as createApiRule,
  publishRule,
  uniqueStamp,
} from "./helpers/api";
import { editorLines } from "./helpers/editor";

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

test("reused rule names remain literal while Monaco placeholders remain editable", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
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

test("a reuse insertion is refused when the code changed while the rule loaded", async ({
  page,
  request,
}) => {
  const suffix = uniqueStamp();
  const child = `snippet-stale-child-${suffix}`;
  const parent = `snippet-stale-parent-${suffix}`;
  const name = `Stale reusable rule ${suffix}`;
  await createRule(request, child, name, true);
  await createRule(request, parent, `Stale snippet caller ${suffix}`);
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
