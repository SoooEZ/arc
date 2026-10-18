import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";
import { uniqueId } from "./helpers/api";
import { openInputRule } from "./helpers/editor";

// An input row's unfinished default and its validity belong to that row: they
// follow it through other rows' removal, a rename and a change of type.

async function expectInvalidDefaultCannotSave(
  page: Page,
  request: APIRequestContext,
  id: string,
) {
  const before = await (await request.get(`/api/rules/${id}`)).json();
  const writes: string[] = [];
  const recordWrite = (outgoing: Request) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().endsWith(`/api/rules/${id}`)
    )
      writes.push(outgoing.url());
  };
  page.on("request", recordWrite);
  try {
    await expect(
      page.getByText("Enter valid JSON before saving", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByText(
        "Fix the invalid parameter default before saving or changing views",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toEqual([]);
    const after = await (await request.get(`/api/rules/${id}`)).json();
    expect(after.revision).toBe(before.revision);
    expect(after.draft).toEqual(before.draft);
  } finally {
    page.off("request", recordWrite);
  }
}

for (const secondDefault of [[], [1]]) {
  test(`removing an invalid input clears only that row's JSON buffer and validity (${JSON.stringify(secondDefault)})`, async ({
    page,
    request,
  }) => {
    const id = uniqueId("input-row-remove");
    await openInputRule(page, request, id, [
      { name: "first", type: "ARRAY", required: false, defaultValue: [] },
      {
        name: "second",
        type: "ARRAY",
        required: false,
        defaultValue: secondDefault,
      },
    ]);
    await page.getByLabel("Default JSON (optional)").nth(0).fill("[");
    await expectInvalidDefaultCannotSave(page, request, id);
    await page
      .getByRole("button", { name: "Remove first", exact: true })
      .click();
    await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
      JSON.stringify(secondDefault, null, 2),
    );
    await expect(page.getByText("Enter valid JSON before saving")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs).toHaveLength(1);
    expect(saved.draft.inputs[0]).toMatchObject({
      name: "second",
      type: "ARRAY",
      required: false,
      defaultValue: secondDefault,
    });
  });
}

for (const defaultValue of [null, []]) {
  test(`changing structured input type resets its default editor and invalid state (${JSON.stringify(defaultValue)})`, async ({
    page,
    request,
  }) => {
    const id = uniqueId("input-type-change");
    await openInputRule(page, request, id, [
      { name: "payload", type: "ARRAY", required: false, defaultValue },
    ]);
    await page.getByLabel("Default JSON (optional)").fill("[");
    await expectInvalidDefaultCannotSave(page, request, id);
    await page.getByRole("combobox", { name: "Type", exact: true }).click();
    await page.getByRole("option", { name: "object", exact: true }).click();
    // No default is an empty buffer; "null" there became null[1] when typed after.
    await expect(page.getByLabel("Default JSON (optional)")).toHaveValue("");
    await expect(page.getByText("Enter valid JSON before saving")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    const saved = await (await request.get(`/api/rules/${id}`)).json();
    expect(saved.draft.inputs[0]).toMatchObject({
      name: "payload",
      type: "OBJECT",
      defaultValue: null,
    });
  });
}

test("input row identity preserves another row's invalid buffer through deletion and rename", async ({
  page,
  request,
}) => {
  const id = uniqueId("input-row-retain");
  await openInputRule(page, request, id, [
    { name: "first", type: "ARRAY", required: false, defaultValue: [] },
    { name: "second", type: "ARRAY", required: false, defaultValue: [] },
  ]);
  await page.getByLabel("Default JSON (optional)").nth(1).fill("[unfinished");
  await page.getByRole("button", { name: "Remove first", exact: true }).click();
  await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
    "[unfinished",
  );
  await page.getByLabel("Parameter name", { exact: true }).fill("renamed");
  await expect(
    page.getByLabel("Parameter name", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Default JSON (optional)")).toHaveValue(
    "[unfinished",
  );
  await expectInvalidDefaultCannotSave(page, request, id);
  await page.getByLabel("Default JSON (optional)").fill("[3]");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs).toHaveLength(1);
  expect(saved.draft.inputs[0]).toMatchObject({
    name: "renamed",
    type: "ARRAY",
    defaultValue: [3],
  });
});
