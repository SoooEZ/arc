import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { setEditorText } from "./helpers/editor";
import {
  createRule,
  deleteRule,
  publishRule,
  uniqueStamp,
} from "./helpers/api";

function definition(
  expression: string,
  inputs: Definition["inputs"],
): Definition {
  return {
    schemaVersion: 1,
    inputs,
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate price",
        expression,
        output: "price",
        position: { x: 0, y: 180 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "$ROUND(price, 2)",
        position: { x: 0, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
      { id: "end", source: "calc", target: "out", sourceHandle: "next" },
    ],
  };
}

async function fixtures(request: APIRequestContext) {
  const suffix = uniqueStamp();
  const amount = {
    name: "amount",
    type: "NUMBER" as const,
    required: true,
    defaultValue: 100,
  };
  const callee = `completion-price-${suffix}`;
  const rule: Rule = await createRule(request, {
    id: callee,
    name: `Completion formula ${suffix}`,
    kind: "FORMULA",
    definition: definition("amount * 2", [amount]),
  });
  await publishRule(request, rule);
  const caller = `completion-caller-${suffix}`;
  await createRule(request, {
    id: caller,
    name: caller,
    kind: "FORMULA",
    definition: definition("amount", [amount]),
  });
  return { callee, caller };
}

/** Published Formula searches and pinned-version reads made by `@` completion. */
function formulaTraffic(page: Page, callee: string) {
  const traffic = { searches: 0, versionReads: 0 };
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      url.pathname === "/api/rule-summaries" &&
      url.searchParams.get("kind") === "FORMULA" &&
      url.searchParams.get("limit") === "8"
    )
      traffic.searches += 1;
    if (url.pathname === `/api/rules/${callee}/versions/1`)
      traffic.versionReads += 1;
  });
  return traffic;
}

function suggestion(page: Page, callee: string) {
  return page
    .locator(".suggest-widget.visible")
    .getByRole("option", { name: new RegExp(`@${callee}:1`) });
}

test("typing an @ call searches published formulas after the typing pauses", async ({
  page,
  request,
}) => {
  const { callee, caller } = await fixtures(request);
  const traffic = formulaTraffic(page, callee);
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toBeVisible();
  // One search for the settled prefix instead of one per keystroke.
  expect(traffic.searches).toBeLessThanOrEqual(2);
  expect(traffic.versionReads).toBe(1);
});

test("editors share immutable pinned formula metadata", async ({
  page,
  request,
}) => {
  const { callee, caller } = await fixtures(request);
  const traffic = formulaTraffic(page, callee);
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toBeVisible();
  await page.keyboard.press("Escape");
  expect(traffic.versionReads).toBe(1);

  // A different node mounts a new editor; the pinned version is not read again.
  await page.locator('.react-flow__node[data-id="out"] .graph-node').click();
  const returnValue = page.getByLabel("Return value", { exact: true });
  await setEditorText(page, returnValue, "");
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toBeVisible();
  expect(traffic.versionReads).toBe(1);
});

test("a variable scope that finishes loading leaves an open formula suggestion list alone", async ({
  page,
  request,
}) => {
  const { callee, caller } = await fixtures(request);
  const traffic = formulaTraffic(page, callee);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false;
  // Scope and diagnostic responses re-render the inspector without changing its text.
  for (const path of ["**/api/variables", "**/api/diagnostics"])
    await page.route(path, async (route) => {
      if (holding) await released;
      // Typing aborts superseded reads while they are held.
      await route.continue().catch(() => undefined);
    });
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  holding = true;
  // An expression edit reads diagnostics (the scope depends on structure only);
  // their answer re-renders the inspector the same way.
  const heldScope = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/diagnostics"),
  );
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toBeVisible();
  await heldScope;
  const searches = traffic.searches;

  const scope = page.waitForResponse((response) =>
    response.url().endsWith("/api/diagnostics"),
  );
  holding = false;
  release();
  await scope;
  // Allow a provider re-registration and a debounced search to show up.
  await page.waitForTimeout(600);
  await expect(suggestion(page, callee)).toBeVisible();
  expect(traffic.searches).toBe(searches);
});

test("a formula created again under a deleted ID offers its new parameters without a reload", async ({
  page,
  request,
}) => {
  const { callee, caller } = await fixtures(request);
  await page.goto(`/#/rules/${caller}?node=calc`);
  const expression = page.getByLabel("Expression", { exact: true });
  await setEditorText(page, expression, "");
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toContainText("amount: number");
  await page.keyboard.press("Escape");

  // Deleted and created again elsewhere with another contract, then published.
  await deleteRule(request, callee);
  const rule: Rule = await createRule(request, {
    id: callee,
    name: "Recreated formula",
    kind: "FORMULA",
    definition: definition("amount", [
      {
        name: "country",
        type: "STRING",
        required: true,
        defaultValue: "US",
      },
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ]),
  });
  await publishRule(request, rule);

  await setEditorText(page, expression, "");
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toContainText("country: string");
  await page.keyboard.press("Escape");
});

test("a failed Formula search is reported in every editor and clears with the next search", async ({
  page,
  request,
}) => {
  const { callee, caller } = await fixtures(request);
  let failing = true;
  await page.route("**/api/rule-summaries?*", (route) => {
    const url = new URL(route.request().url());
    if (failing && url.searchParams.get("kind") === "FORMULA")
      return route.fulfill({
        status: 500,
        json: { message: "Formula search exploded" },
      });
    return route.fallback();
  });
  const problem = "Formula suggestions unavailable: Formula search exploded";
  await page.goto(`/#/rules/${caller}?node=calc`);
  // The Expression dialog's aside showed only function catalog errors.
  await page
    .getByRole("button", { name: "Open in Editor · Expression", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Expression editor · Expression",
    exact: true,
  });
  const expression = dialog.getByLabel("Expression code editor", {
    exact: true,
  });
  await setEditorText(page, expression, "");
  await page.keyboard.type("@comp");
  await expect(
    dialog.getByRole("alert").filter({ hasText: problem }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  // The node code dialog showed build and catalog errors only.
  await page
    .locator(".inspector-sidebar")
    .getByRole("button", { name: "Node expression", exact: true })
    .click();
  const nodeDialog = page.getByRole("dialog", {
    name: "Node expression · Calculate price",
    exact: true,
  });
  const code = nodeDialog.getByLabel("Node code editor", { exact: true });
  await setEditorText(
    page,
    code,
    'node calc FORMULA "Calculate price" { let price = ',
  );
  await page.keyboard.type("@comp");
  await expect(
    nodeDialog.getByRole("alert").filter({ hasText: problem }),
  ).toBeVisible();
  await nodeDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  // Code studio's library showed insertion and catalog errors only.
  await page.goto(`/#/studio/${caller}`);
  const script = page.getByLabel("ARC code editor", { exact: true });
  await setEditorText(page, script, "let x = ");
  await page.keyboard.type("@comp");
  const libraryAlert = page
    .locator(".studio-library")
    .getByRole("alert")
    .filter({ hasText: problem });
  await expect(libraryAlert).toBeVisible();
  failing = false;
  await page.keyboard.type("l");
  await page.keyboard.press("Control+Space");
  await expect(suggestion(page, callee)).toBeVisible();
  await expect(libraryAlert).toHaveCount(0);
});
