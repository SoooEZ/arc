import { expect, test } from "@playwright/test";

test("library, graph preview, reference navigation, and published API execution", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  await page.getByPlaceholder("Search rules…").fill("order pricing");
  await expect(page.locator(".rule-card")).toHaveCount(1);
  await page.locator(".rule-card").click();
  await expect(
    page.getByRole("heading", { name: "Order pricing", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__minimap-node")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("120");
  await expect(page.locator(".node-visited")).toHaveCount(4);
  await page
    .locator(".test-input textarea:not([aria-hidden])")
    .fill('{"orderTotal": 150, "customerTier": "standard"}');
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText("135");
  await page
    .locator(".test-input textarea:not([aria-hidden])")
    .fill('{"orderTotal": "bad", "customerTier": "standard"}');
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("must be number");
  await page.getByRole("button", { name: "Close test panel" }).click();
  await page.getByRole("button", { name: "Node outline" }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Premium discount/ })
    .click();
  await page.getByRole("button", { name: "Open referenced rule" }).click();
  const referenced = page.getByRole("dialog", {
    name: "Referenced rule viewer",
  });
  await expect(
    referenced.getByRole("heading", { name: "Apply discount", exact: true }),
  ).toBeVisible();
  await expect(
    referenced.getByText("Immutable published version"),
  ).toBeVisible();
  await referenced
    .getByRole("button", { name: "Close all", exact: true })
    .click();
  await page
    .getByRole("button", { name: "API playground", exact: true })
    .click();
  await page
    .getByLabel("Find published rules", { exact: true })
    .fill("order-pricing");
  await page.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page
    .getByRole("option", { name: "Order pricing", exact: true })
    .click();
  await page.getByRole("button", { name: "Execute rule", exact: true }).click();
  await expect(page.getByTestId("api-response")).toContainText('"result": 120');
  expect(errors).toEqual([]);
});

test("create, edit a formula, save, publish, reload, and execute", async ({
  page,
  request,
}) => {
  const name = `E2E formula ${Date.now()}`;
  const id = name.toLowerCase().replaceAll(" ", "-");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  await page.getByLabel("Rule name", { exact: true }).fill(name);
  await page.getByLabel("Rule type").click();
  await page.getByRole("option", { name: "Formula", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Node outline" }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Calculate/ })
    .click();
  await page
    .getByLabel("Expression", { exact: true })
    .fill("round(amount * 1.25, 2)");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 1 published and ready to call"),
  ).toBeVisible();
  const result = await request.post(`/api/rules/${id}/execute`, {
    data: { inputs: { amount: 40 } },
  });
  expect(result.ok()).toBeTruthy();
  expect((await result.json()).result).toBe(50);
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Version history" }).click();
  await page
    .locator(".version-bar")
    .getByRole("button", { name: /v1/ })
    .click();
  await expect(page.getByText("Immutable published version")).toBeVisible();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reuse rule", exact: true }).click();
  await page
    .getByLabel("Find published rule", { exact: true })
    .fill("Apply discount");
  await page.getByLabel("Published rule", { exact: true }).click();
  await page
    .getByRole("option", { name: "Apply discount", exact: true })
    .click();
  await page.getByLabel("amount * · value source", { exact: true }).click();
  await page.getByRole("option", { name: "Expression", exact: true }).click();
  await page.getByLabel("amount *", { exact: true }).fill("total");
  await page.getByLabel("rate * · value source", { exact: true }).click();
  await page.getByRole("option", { name: "Constant", exact: true }).click();
  await page.getByLabel("rate *", { exact: true }).fill("0.2");
  await page.getByLabel("Result variable", { exact: true }).fill("finalPrice");
  const referenceId = await page
    .locator(".react-flow__node:has(.node-reference)")
    .getAttribute("data-id");
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrange graph", exact: true }),
  ).toBeEnabled();
  const connectNodes = async (source: string, target: string) => {
    const from = page.locator(
      `.react-flow__node[data-id="${source}"] .react-flow__handle.source`,
    );
    const to = page.locator(
      `.react-flow__node[data-id="${target}"] .react-flow__handle.target`,
    );
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    // Wait for the animated fit-to-view before dragging between measured handles.
    await expect
      .poll(async () =>
        page.locator(".react-flow__viewport").getAttribute("style"),
      )
      .toContain("transform");
    await from.dragTo(to);
    await expect(
      page.locator(
        `.react-flow__edge[aria-label="Edge from ${source} to ${target}"]`,
      ),
    ).toHaveCount(1);
  };
  await connectNodes("calculate", referenceId!);
  await connectNodes(referenceId!, "result");
  await page.getByRole("button", { name: "Node outline", exact: true }).click();
  await page
    .locator(".node-outline")
    .getByRole("button", { name: /Return total/ })
    .click();
  await page.getByLabel("Return value", { exact: true }).click();
  await page.getByRole("option", { name: /finalPrice ·/ }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Version 2 published and ready to call"),
  ).toBeVisible();
  const reused = await request.post(`/api/rules/${id}/execute`, {
    data: { inputs: { amount: 40 } },
  });
  expect(reused.ok()).toBeTruthy();
  expect((await reused.json()).result).toBe(40);
});

test("mobile library and API reference stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Rule library" }),
  ).toBeVisible();
  await expect(page.getByLabel("Find sidebar rule")).toBeHidden();
  await expect(
    page.getByRole("navigation", {
      name: "Sidebar rules pages",
      includeHidden: true,
    }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your logic, on demand." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
