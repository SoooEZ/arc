import { expect, test, type Locator } from "@playwright/test";
import { createRule, uniqueId, uniqueStamp } from "./helpers/api";

/**
 * Renders the element as shown, with ligatures forced off and forced on. The
 * shown pixels must match "off"; "on" must differ, which proves the text and
 * font would otherwise join characters such as == or ->.
 */
async function ligatureRendering(element: Locator) {
  const style = (ligatures: string, features: string) =>
    element.evaluate(
      (node, [variant, settings]) => {
        const target = node as HTMLElement;
        target.style.fontVariantLigatures = variant;
        target.style.fontFeatureSettings = settings;
      },
      [ligatures, features],
    );
  const shown = await element.screenshot({ animations: "disabled" });
  await style("none", '"liga" 0, "calt" 0');
  const off = await element.screenshot({ animations: "disabled" });
  await style("normal", "normal");
  const on = await element.screenshot({ animations: "disabled" });
  await style("", "");
  return { matchesOff: shown.equals(off), ligaturesVisible: !on.equals(off) };
}

test("canvas expressions and JSON fields draw every operator character", async ({
  page,
  request,
}) => {
  const stamp = uniqueStamp();
  const ruleId = `ligatures-${stamp}`;
  await createRule(request, {
    id: ruleId,
    name: ruleId,
    kind: "RULE",
    definition: {
      schemaVersion: 1,
      inputs: [
        {
          name: "amount",
          type: "NUMBER",
          required: true,
          defaultValue: null,
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
          id: "check",
          type: "CONDITION",
          label: "Check",
          expression: "amount == 100 != false",
          position: { x: 200, y: 200 },
        },
      ],
      edges: [
        {
          id: "next",
          source: "input",
          target: "check",
          sourceHandle: "next",
        },
      ],
    },
  });
  await page.goto(`/#/rules/${ruleId}`);
  const preview = page.locator(
    '.react-flow__node[data-id="check"] .node-detail',
  );
  await expect(preview).toHaveText("amount == 100 != false");
  await page.evaluate(() => document.fonts.ready);
  expect(await ligatureRendering(preview)).toEqual({
    matchesOff: true,
    ligaturesVisible: true,
  });
  await expect(preview).toHaveCSS("font-variant-ligatures", "none");

  const sourceName = `Ligature source ${stamp}`;
  const source = await request.post("/api/sources", {
    data: {
      id: `ligatures-${stamp}`,
      name: sourceName,
      definition: {
        kind: "LOOKUP",
        parameters: [
          { name: "key", type: "STRING", required: true, defaultValue: null },
        ],
        entries: { US: "a == b -> c != d" },
        timeoutMs: 3000,
      },
    },
  });
  expect(source.ok(), await source.text()).toBeTruthy();
  await page.goto("/#/sources");
  await page.getByLabel("Search data sources").fill(sourceName);
  await page
    .locator(".source-list > button")
    .filter({ hasText: sourceName })
    .click();
  const entries = page.getByLabel("Lookup entries · JSON object");
  await expect(entries).toHaveValue(/a == b -> c != d/);
  await page.getByRole("heading", { name: sourceName }).click();
  expect(await ligatureRendering(entries)).toEqual({
    matchesOff: true,
    ligaturesVisible: true,
  });
  for (const surface of [entries, page.getByLabel("Test parameters · JSON")])
    await expect(surface).toHaveCSS("font-variant-ligatures", "none");
});

test("JSON default fields draw every operator character", async ({
  page,
  request,
}) => {
  const ruleId = uniqueId("ligature-default");
  await createRule(request, {
    id: ruleId,
    name: ruleId,
    kind: "FORMULA",
    definition: {
      schemaVersion: 1,
      inputs: [
        {
          name: "routes",
          type: "ARRAY",
          required: false,
          defaultValue: ["a == b -> c != d"],
        },
      ],
      nodes: [
        {
          id: "input",
          type: "INPUT",
          label: "Inputs",
          position: { x: 0, y: 0 },
        },
        {
          id: "out",
          type: "OUTPUT",
          label: "Result",
          expression: "routes",
          position: { x: 0, y: 200 },
        },
      ],
      edges: [
        { id: "next", source: "input", target: "out", sourceHandle: "next" },
      ],
    },
  });
  await page.goto(`/#/rules/${ruleId}?node=input`);
  const field = page
    .locator(".inspector-sidebar")
    .getByLabel("Default JSON (optional)", { exact: true });
  await expect(field).toHaveValue(/a == b -> c != d/);
  await page.evaluate(() => document.fonts.ready);
  await expect(field).toHaveCSS("font-variant-ligatures", "none");
  expect(await ligatureRendering(field)).toEqual({
    matchesOff: true,
    ligaturesVisible: true,
  });
});
