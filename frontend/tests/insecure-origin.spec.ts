import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function definition(): Definition {
  return {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 25 },
    ],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 150, y: 0 },
      },
      {
        id: "calc",
        type: "FORMULA",
        label: "Calculate total",
        expression: "amount * 2",
        output: "total",
        position: { x: 150, y: 180 },
      },
      {
        id: "choose",
        type: "SWITCH",
        label: "Choose tier",
        cases: [{ id: "high", label: "High", expression: "total > 10" }],
        position: { x: 150, y: 400 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "calc", sourceHandle: "next" },
    ],
  };
}

async function create(request: APIRequestContext) {
  const id = `insecure-origin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/rules", {
    data: { id, name: id, kind: "DECISION_TREE", definition: definition() },
  });
  expect(response.status()).toBe(201);
  return id;
}

test("graph edits generate IDs where crypto.randomUUID is unavailable", async ({
  page,
  request,
}) => {
  // Plain-HTTP origins other than localhost are not secure contexts, so their
  // crypto object lacks randomUUID; localhost test servers always have it.
  await page.addInitScript(() => {
    Reflect.deleteProperty(Crypto.prototype, "randomUUID");
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const id = await create(request);
  await page.goto(`/#/rules/${id}?node=choose`);
  await expect(page.locator('.react-flow__node[data-id="calc"]')).toBeVisible();
  expect(
    await page.evaluate(() => typeof Reflect.get(crypto, "randomUUID")),
  ).toBe("undefined");

  await page.getByRole("button", { name: "Add case", exact: true }).click();
  await expect(
    page.locator(
      '.react-flow__node[data-id="choose"] .react-flow__handle.source[data-handleid^="case:case-"]',
    ),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add default return", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);

  const source = page.locator(
    '.react-flow__node[data-id="calc"] .react-flow__handle.source',
  );
  const target = page.locator(
    '.react-flow__node[data-id="choose"] .react-flow__handle.target',
  );
  await source.hover();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(
    page.locator('.react-flow__edge[aria-label="Edge from calc to choose"]'),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Formula", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(pageErrors).toEqual([]);
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  const draft = saved.draft;
  const edge = draft.edges.find(
    (candidate) => candidate.source === "calc" && candidate.target === "choose",
  );
  expect(edge?.id).toMatch(uuidV4);
  const cases = draft.nodes.find((node) => node.id === "choose")?.cases ?? [];
  expect(cases.map((option) => option.id)).toEqual([
    "high",
    expect.stringMatching(/^case-[0-9a-f]{8}$/),
  ]);
  const fallback = draft.edges.find(
    (candidate) =>
      candidate.source === "choose" && candidate.sourceHandle === "default",
  );
  expect(fallback?.id).toMatch(/^edge-[0-9a-f]{8}$/);
  expect(fallback?.target).toMatch(/^default-[0-9a-f]{8}$/);
  const added = draft.nodes.filter((node) =>
    /^node-[0-9a-f]{8}$/.test(node.id),
  );
  expect(added).toMatchObject([{ type: "FORMULA", output: "result_1" }]);
});
