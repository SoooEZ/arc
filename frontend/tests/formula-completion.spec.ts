import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { setEditorText } from "./helpers/editor";

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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amount = {
    name: "amount",
    type: "NUMBER" as const,
    required: true,
    defaultValue: 100,
  };
  const callee = `completion-price-${suffix}`;
  const created = await request.post("/api/rules", {
    data: {
      id: callee,
      name: `Completion formula ${suffix}`,
      kind: "FORMULA",
      definition: definition("amount * 2", [amount]),
    },
  });
  expect(created.status()).toBe(201);
  const rule: Rule = await created.json();
  const published = await request.post(`/api/rules/${callee}/publish`, {
    data: { revision: rule.revision },
  });
  expect(published.ok()).toBeTruthy();
  const caller = `completion-caller-${suffix}`;
  const callerCreated = await request.post("/api/rules", {
    data: {
      id: caller,
      name: caller,
      kind: "FORMULA",
      definition: definition("amount", [amount]),
    },
  });
  expect(callerCreated.status()).toBe(201);
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
  const heldScope = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith("/api/variables"),
  );
  await page.keyboard.type(`@${callee}`);
  await expect(suggestion(page, callee)).toBeVisible();
  await heldScope;
  const searches = traffic.searches;

  const scope = page.waitForResponse((response) =>
    response.url().endsWith("/api/variables"),
  );
  holding = false;
  release();
  await scope;
  // Allow a provider re-registration and a debounced search to show up.
  await page.waitForTimeout(600);
  await expect(suggestion(page, callee)).toBeVisible();
  expect(traffic.searches).toBe(searches);
});
