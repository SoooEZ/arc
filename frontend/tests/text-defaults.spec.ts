import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "label", type: "STRING", required: false, defaultValue: "ok" },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 250, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "label",
      position: { x: 250, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

// A STRING default had no check: text the server refuses reached the draft
// and the save failed with a 422 alert.
test("a text default the server would refuse stays in its field with the reason and blocks writes", async ({
  page,
  request,
}) => {
  const id = uniqueId("text-default");
  const original = await createRule(request, {
    id,
    name: id,
    kind: "FORMULA",
    definition,
  });
  const writes: string[] = [];
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().endsWith(`/api/rules/${id}`)
    )
      writes.push(outgoing.postData() ?? "");
  });
  await page.goto(`/#/rules/${id}?node=input`);
  const field = page.getByLabel("Default value (optional)");
  await expect(field).toHaveValue("ok");
  const tooLong = "x".repeat(2001);
  await field.fill(tooLong);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("String exceeds 2,000 characters")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText(
      "Fix the invalid parameter default before saving or changing views",
      { exact: true },
    ),
  ).toBeVisible();
  expect(writes).toEqual([]);
  const unchanged: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(unchanged.revision).toBe(original.revision);

  await field.fill("x".repeat(2000));
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].defaultValue).toBe("x".repeat(2000));
});
