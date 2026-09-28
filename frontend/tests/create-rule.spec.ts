import { expect, test } from "@playwright/test";

test("Rule ID rejects forbidden typing and pasted whitespace while keeping the accepted value", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const name = `Rule ID ${stamp}`;
  const generatedId = `rule-id-${stamp}`;
  const submitted: { id: string; name: string }[] = [];
  page.on("request", (sent) => {
    if (
      sent.method() === "POST" &&
      new URL(sent.url()).pathname === "/api/rules"
    )
      submitted.push(sent.postDataJSON());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  const id = dialog.getByLabel("Rule ID", { exact: true });
  const create = dialog.getByRole("button", {
    name: "Create rule",
    exact: true,
  });
  await dialog.getByLabel("Rule name", { exact: true }).fill(name);
  await expect(id).toHaveValue(generatedId);
  await id.click();
  await id.press("End");
  for (const key of ["Space", "$", "@"]) {
    await id.press(key);
    await expect(id).toHaveValue(generatedId);
    await expect(id).toHaveAttribute("aria-invalid", "true");
  }
  for (const invalid of [
    "bad id",
    "bad$id",
    "bad@id",
    "1bad",
    "UPPERCASE",
    "bad_id",
    "a".repeat(81),
  ]) {
    await id.fill(invalid);
    await expect(id).toHaveValue(generatedId);
  }
  for (const pasted of [
    "bad\tid",
    "bad\nid",
    "bad\rid",
    "bad\u00a0id",
    "$bad",
    "@bad",
  ]) {
    const accepted = await id.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      return element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, pasted);
    expect(accepted).toBe(false);
    await expect(id).toHaveValue(generatedId);
  }
  await expect(dialog.getByText(/No spaces, \$ or @/)).toBeVisible();
  expect(submitted).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({
    path: test.info().outputPath("rule-id-validation-mobile.png"),
  });
  await id.fill("");
  await expect(create).toBeDisabled();
  const chosenId = `custom-rule-${stamp}`;
  await id.pressSequentially(chosenId);
  await expect(id).toHaveAttribute("aria-invalid", "false");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(submitted).toEqual([expect.objectContaining({ id: chosenId, name })]);
  const stored = await request.get(`/api/rules/${chosenId}`);
  expect(stored.ok()).toBeTruthy();
  expect(await stored.json()).toMatchObject({ id: chosenId, name });
});

test("generated Rule IDs satisfy the server policy and invalid IDs are rejected by the API", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const name = `2026 Pricing $ @ ${stamp} ${"x".repeat(100)}`;
  const prefix = `rule-2026-pricing-${stamp}-`;
  const expectedId = prefix + "x".repeat(80 - prefix.length);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Rule name", { exact: true }).fill(name);
  const id = dialog.getByLabel("Rule ID", { exact: true });
  await expect(id).toHaveValue(expectedId);
  expect(expectedId).toHaveLength(80);
  await expect(id).toHaveAttribute("aria-invalid", "false");
  await dialog
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect((await request.get(`/api/rules/${expectedId}`)).ok()).toBeTruthy();
  for (const invalid of [
    null,
    "",
    "bad id",
    " bad",
    "bad ",
    "bad\tid",
    "bad\nid",
    "bad\u00a0id",
    "bad$id",
    "bad@id",
    "1bad",
    "Bad",
    "bad_id",
    "a".repeat(81),
  ]) {
    const rejected = await request.post("/api/rules", {
      data: { id: invalid, name: "Invalid Rule ID", kind: "FORMULA" },
    });
    expect(rejected.status(), await rejected.text()).toBe(422);
    expect((await rejected.json()).message).toContain(
      "Rule ID must start with a lowercase letter",
    );
  }
});

test("editing the name keeps a Rule ID the user chose", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const submitted: { id: string; name: string }[] = [];
  page.on("request", (sent) => {
    if (
      sent.method() === "POST" &&
      new URL(sent.url()).pathname === "/api/rules"
    )
      submitted.push(sent.postDataJSON());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("Rule name", { exact: true });
  const id = dialog.getByLabel("Rule ID", { exact: true });
  await name.fill(`Tax ${stamp}`);
  await expect(id).toHaveValue(`tax-${stamp}`);
  const chosenId = `vat-${stamp}`;
  await id.fill(chosenId);
  await name.fill(`Tax rules ${stamp}`);
  await expect(id).toHaveValue(chosenId);

  // Clearing the ID hands it back to the name.
  await id.fill("");
  await name.fill(`Sales tax ${stamp}`);
  await expect(id).toHaveValue(`sales-tax-${stamp}`);
  await id.fill(chosenId);
  await name.fill(`Tax ${stamp}`);
  await expect(id).toHaveValue(chosenId);

  await dialog
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Tax ${stamp}`, exact: true }),
  ).toBeVisible();
  expect(submitted).toEqual([
    expect.objectContaining({ id: chosenId, name: `Tax ${stamp}` }),
  ]);
  expect((await request.get(`/api/rules/${chosenId}`)).ok()).toBeTruthy();
});

test("a notice survives clicks elsewhere and clears on its own", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Rule name", { exact: true })
    .fill(`Notice ${Date.now()}`);
  await dialog
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  const notice = page.getByText("Rule created. Make it yours.", {
    exact: true,
  });
  await expect(notice).toBeVisible();
  // MUI reports any click outside the notice as "clickaway", which used to close it at once.
  const nodeName = page.getByLabel("Node name", { exact: true });
  await nodeName.click();
  await expect(nodeName).toBeFocused();
  await expect(notice).toBeVisible();
  await expect(notice).toBeHidden({ timeout: 8000 });
});

test("a name beyond the server's limit disables Create and shows the server's message", async ({
  page,
}) => {
  const submitted: unknown[] = [];
  page.on("request", (sent) => {
    if (
      sent.method() === "POST" &&
      new URL(sent.url()).pathname === "/api/rules"
    )
      submitted.push(sent.postDataJSON());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("Rule name", { exact: true });
  const create = dialog.getByRole("button", {
    name: "Create rule",
    exact: true,
  });
  await name.fill("n".repeat(161));
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Rule name must contain 1 to 160 characters"),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  await name.fill("n".repeat(160));
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(create).toBeEnabled();
  const description = dialog.getByLabel("Description", { exact: true });
  await description.fill("d".repeat(2001));
  await expect(
    dialog.getByText("Description exceeds 2,000 characters"),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  expect(submitted).toEqual([]);
});
