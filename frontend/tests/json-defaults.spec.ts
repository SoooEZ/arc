import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition } from "../src/types";

async function openArrayDefault(
  page: Page,
  request: APIRequestContext,
  defaultValue: unknown,
) {
  const id = `json-default-${Date.now()}`;
  const definition: Definition = {
    schemaVersion: 1,
    inputs: [{ name: "limits", type: "ARRAY", required: false, defaultValue }],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "limits",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "out", sourceHandle: "next" },
    ],
  };
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(created.ok()).toBe(true);
  await page.goto(`/#/rules/${id}?node=input`);
  const field = page
    .locator(".inspector-sidebar")
    .getByLabel("Default JSON (optional)", { exact: true });
  await expect(field).toBeVisible();
  return { id, field };
}

/** The stored draft as raw JSON text: parsing it into doubles would hide rounding. */
async function storedDraft(request: APIRequestContext, id: string) {
  return (await request.get(`/api/rules/${id}`)).text();
}

test("typing into a JSON default keeps the caret in place and every digit", async ({
  page,
  request,
}) => {
  const { id, field } = await openArrayDefault(page, request, [1]);
  await expect(field).toHaveValue("[\n  1\n]");
  await field.focus();
  await field.evaluate((element: HTMLTextAreaElement) => {
    const afterOne = element.value.indexOf("1") + 1;
    element.setSelectionRange(afterOne, afterOne);
  });
  // Each digit completes a valid document, which returns to the field as its value.
  await page.keyboard.type(",9007199254740993");
  await expect(field).toHaveValue("[\n  1,9007199254740993\n]");
  await expect(field).toHaveAttribute("aria-invalid", "false");

  const saved = page.waitForRequest(
    (outgoing) =>
      outgoing.method() === "PUT" &&
      outgoing.url().endsWith(`/api/rules/${id}`),
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await saved).postData()).toContain(
    '"defaultValue":[1,9007199254740993]',
  );
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(await storedDraft(request, id)).toContain(
    '"defaultValue":[1,9007199254740993]',
  );

  await page.reload();
  await expect(field).toHaveValue("[\n  1,\n  9007199254740993\n]");
});

test("a JSON default shows values applied from outside and keeps a cleared buffer empty", async ({
  page,
  request,
}) => {
  const { id, field } = await openArrayDefault(page, request, [1]);
  const input = page.locator('.react-flow__node[data-id="input"] .graph-node');
  await input.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit node/ });
  await dialog
    .getByLabel("Default JSON (optional)", { exact: true })
    .fill("[2, 12345678901234567890]");
  await dialog
    .getByRole("button", { name: "Apply to graph", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(field).toHaveValue("[\n  2,\n  12345678901234567890\n]");

  await field.fill("");
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(await storedDraft(request, id)).toContain(
    '"name":"limits","type":"ARRAY","required":false,"defaultValue":null',
  );
});
