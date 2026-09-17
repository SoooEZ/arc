import { expect, test } from "@playwright/test";

async function replaceCode(
  page: import("@playwright/test").Page,
  code: string,
) {
  await page.locator(".monaco-editor").click({ position: { x: 200, y: 60 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}

test("code studio builds, round-trips graph edits, inserts chips/modules, and publishes sourced rules", async ({
  page,
  request,
}) => {
  const id = `studio-e2e-${Date.now()}`;
  const response = await request.post("/api/rules", {
    data: {
      id,
      name: "Studio round trip",
      kind: "DECISION_TREE",
      description: "Browser integration fixture",
    },
  });
  expect(response.ok()).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#/studio/${id}`);
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".studio-filebar")).toContainText(`${id}.arc`);
  await page.getByPlaceholder("Search functions…").fill("SUM");
  const sum = page
    .locator(".function-chips")
    .getByRole("button", { name: "SUM", exact: true });
  await sum.hover();
  await expect(page.getByRole("tooltip")).toContainText("Aggregates");
  await page.locator(".monaco-editor").click({ position: { x: 200, y: 60 } });
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await sum.click();
  await expect(page.locator(".view-lines")).toContainText("SUM(values)");
  await page.getByRole("button", { name: "modules", exact: true }).click();
  await page
    .getByRole("button", { name: "Decision branch +", exact: true })
    .click();
  await expect(page.locator(".view-lines")).toContainText("Check eligibility");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Template decision");
  await expect(page.locator(".view-lines")).toContainText("Template decision");
  await page.getByRole("button", { name: "reuse", exact: true }).click();
  await page
    .locator(".snippet-card")
    .filter({ hasText: "Apply discount" })
    .click();
  await expect(page.locator(".view-lines")).toContainText(
    'use "apply-discount" version 1',
  );
  const code = `schema 1;
// round trip comment
inputs {
  amount: NUMBER required default 100;
  country: STRING required default "US";
  taxRate: NUMBER required;
  source taxRate = {"id":"country-tax","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"FAIL"};
}
node input INPUT "Input" { next -> check; }
node check CONDITION "Order minimum" {
  when amount >= 100;
  true -> calculate;
  false -> zero;
}
node calculate FORMULA "Taxed amount" {
  let subtotal = ROUND(amount * (1 + taxRate), 2);
  next -> reuse;
}
node reuse REFERENCE "Discount" {
  use "apply-discount" version 1;
  bind amount = subtotal;
  bind rate = 0.1;
  as discounted;
  next -> output;
}
node output OUTPUT "Final amount" { return discounted; }
node zero OUTPUT "Below minimum" { return 0; }
`;
  await replaceCode(page, code);
  await page.getByRole("button", { name: "Build graph", exact: true }).click();
  await expect(page.locator(".studio-filebar")).toContainText("graph synced");
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("96.3");
  await page.getByRole("button", { name: "Close test panel" }).click();
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Taxed amount/ })
    .click();
  await page
    .getByLabel("Expression", { exact: true })
    .fill("ROUND(amount * 2, 2)");
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Input/ })
    .click();
  await expect(page.getByLabel("JSON pointer", { exact: true })).toHaveValue(
    "/rate",
  );
  await page.getByLabel("Source key · value source", { exact: true }).click();
  await page.getByRole("option", { name: "Constant", exact: true }).click();
  await page.getByLabel("Source key", { exact: true }).fill("GB");
  await page.getByRole("button", { name: "Code editor", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText(
    "ROUND(amount * 2, 2)",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const saved = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.notes).toContain("round trip comment");
  expect(
    saved.draft.inputs.find((p: { name: string }) => p.name === "taxRate")
      .source.version,
  ).toBe(1);
  const run = await (
    await request.post(`/api/rules/${id}/execute`, {
      data: { inputs: { amount: 100, country: "US" } },
    })
  ).json();
  expect(
    saved.draft.inputs.find((p: { name: string }) => p.name === "taxRate")
      .source.bindings.key,
  ).toBe('"GB"');
  expect(run.result).toBe(180);
  expect(run.sources[0].sourceId).toBe("country-tax");
  const override = await (
    await request.post(`/api/rules/${id}/execute`, {
      data: { inputs: { amount: 50, country: "XX", taxRate: 0.3 } },
    })
  ).json();
  expect(override.result).toBe(0);
  expect(override.sources).toEqual([]);
  // An invalid script must preserve the last working graph and remain in the editor.
  await replaceCode(page, code.replace("amount >= 100", "amount >="));
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await expect(page.locator(".studio-problems")).toContainText("build problem");
  await expect(page).toHaveURL(new RegExp(`/studio/${id}`));
  await expect(page.getByRole("alert").first()).toContainText(
    "Incomplete expression",
  );
  expect(
    (await (await request.get(`/api/rules/${id}`)).json()).publishedVersion,
  ).toBe(1);
  expect(errors).toEqual([]);
});

test("data source UI creates, tests and versions a lookup table", async ({
  page,
  request,
}) => {
  const id = `source-e2e-${Date.now()}`;
  await page.goto("/#/sources");
  await expect(
    page.getByRole("heading", { name: "Data sources." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New source", exact: true }).click();
  await page.getByLabel("Source ID", { exact: true }).fill(id);
  await page.getByLabel("Name", { exact: true }).fill("Exchange table");
  await page
    .getByLabel("Lookup entries · JSON object", { exact: true })
    .fill('{"US":{"rate":1.1},"GB":{"rate":1.3}}');
  await page
    .getByRole("button", { name: "Create source", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Exchange table", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fetch sample", exact: true }).click();
  await expect(page.getByTestId("source-result")).toContainText('"rate": 1.1');
  await page
    .getByLabel("Lookup entries · JSON object", { exact: true })
    .fill('{"US":{"rate":2.2}}');
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(
    page.getByText(
      "Data source v2 saved. Existing rules keep their pinned version.",
    ),
  ).toBeVisible();
  const old = await (
    await request.post(`/api/sources/${id}/test`, {
      data: { version: 1, inputs: { key: "US" } },
    })
  ).json();
  expect(old.result.rate).toBe(1.1);
  const latest = await (
    await request.post(`/api/sources/${id}/test`, {
      data: { version: 2, inputs: { key: "US" } },
    })
  ).json();
  expect(latest.result.rate).toBe(2.2);
  await page.getByLabel("Inspect version").click();
  await page.getByRole("option", { name: "v1 · immutable" }).click();
  await expect(
    page.getByText(
      "Viewing an immutable configuration. Choose the latest version to edit.",
    ),
  ).toBeVisible();
});

test("code studio and sources adapt to a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/studio/order-pricing");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(392);
  await page.goto("/#/sources");
  await expect(
    page.getByRole("heading", { name: "Data sources." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(392);
});
