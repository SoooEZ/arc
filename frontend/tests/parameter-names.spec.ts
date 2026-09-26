import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";

test("parameter names reject whitespace and dollars without losing edits, row identity, or literal keys", async ({
  page,
  request,
}, testInfo) => {
  const id = `parameter-names-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [
      { name: "first", type: "NUMBER", required: true, defaultValue: 1 },
      {
        name: "payload",
        type: "OBJECT",
        required: false,
        defaultValue: { "display name": "$value" },
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
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "7",
        position: { x: 200, y: 180 },
      },
    ],
    edges: [
      { id: "next", source: "input", sourceHandle: "next", target: "output" },
    ],
  };
  expect(
    (
      await request.post("/api/rules", {
        data: { id, name: id, kind: "FORMULA", definition },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#/rules/${id}?node=input`);
  const names = page.getByLabel("Parameter name", { exact: true });
  const name = names.nth(1);
  await name.click();
  await name.press("End");
  await name.press("Space");
  await name.press("$");
  await expect(name).toHaveValue("payload");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator(".input-schema-card")
      .nth(1)
      .screenshot({
        path: testInfo.outputPath(`parameter-name-error-${width}.png`),
      });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  for (const text of [
    "customer name",
    "$customer",
    "customer\tname",
    "customer\nname",
    "customer\u00a0name",
  ]) {
    const accepted = await name.evaluate((element, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", value);
      return element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
    expect(accepted).toBe(false);
    await expect(name).toHaveValue("payload");
  }
  await page.getByLabel("Default JSON (optional)").fill('{"unfinished":');
  await name.fill("");
  await name.pressSequentially("trueValue");
  await expect(name).toHaveValue("trueValue");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "Remove first", exact: true }).click();
  await expect(names).toHaveValue("trueValue");
  await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
    '{"unfinished":',
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText(
      "Fix the invalid JSON default before saving or changing views",
      { exact: true },
    ),
  ).toBeVisible();
  const defaultValue = { "display name": "$value", $field: "contains spaces" };
  await page
    .getByLabel("Default JSON (optional)")
    .fill(JSON.stringify(defaultValue));
  await names.fill("SUM");
  await page
    .getByLabel("Node name", { exact: true })
    .fill("Input $ display name");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs).toEqual([
    {
      name: "SUM",
      type: "OBJECT",
      required: false,
      defaultValue,
      source: null,
    },
  ]);
  expect(saved.draft.nodes[0].label).toBe("Input $ display name");
  expect(saved.draft.nodes[1].expression).toBe("7");
});

test("source parameter JSON retains invalid drafts, blocks invalid names before saving, and preserves data literals", async ({
  page,
  request,
}, testInfo) => {
  const id = `source-parameter-names-${Date.now()}`;
  await page.goto("/#/sources");
  await page.getByRole("button", { name: "New source", exact: true }).click();
  await page.getByLabel("Source ID", { exact: true }).fill(id);
  await page.getByLabel("Name", { exact: true }).fill("Source $ display name");
  await page.getByRole("combobox", { name: "Provider", exact: true }).click();
  await page
    .getByRole("option", { name: "HTTP GET · JSON response", exact: true })
    .click();
  await page
    .getByLabel("HTTP URL", { exact: true })
    .fill("https://example.com/profile");
  const parameters = page.getByLabel("Source parameters · JSON", {
    exact: true,
  });
  const writes: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      new URL(outgoing.url()).pathname === "/api/sources"
    )
      writes.push(outgoing.url());
  });
  for (const name of [
    "customer name",
    "$customer",
    "customer$name",
    "customer\tname",
    "FALSE",
  ]) {
    const text = JSON.stringify([
      { name, type: "STRING", required: true, defaultValue: null },
    ]);
    await parameters.fill(text);
    await expect(parameters).toHaveValue(text);
    await expect(parameters).toHaveAttribute("aria-invalid", "true");
    if (name === "customer name") {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await parameters
          .locator("..")
          .locator("..")
          .screenshot({
            path: testInfo.outputPath(`source-parameter-error-${width}.png`),
          });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page
      .getByRole("button", { name: "Create source", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Parameter 1:" }),
    ).toBeVisible();
    await expect(parameters).toHaveValue(text);
    expect(writes).toEqual([]);
  }
  const declarations = [
    { name: "key", type: "STRING", required: true, defaultValue: null },
    {
      name: "SUM",
      type: "STRING",
      required: false,
      defaultValue: "$value contains spaces",
    },
  ];
  await parameters.fill(JSON.stringify(declarations));
  await expect(parameters).toHaveAttribute("aria-invalid", "false");
  await page
    .getByRole("button", { name: "Create source", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Source $ display name", exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  const saved = await (
    await request.get(`/api/sources/${id}/versions/1`)
  ).json();
  expect(saved.definition.parameters).toEqual(
    declarations.map((parameter) => ({ ...parameter, source: null })),
  );
});
