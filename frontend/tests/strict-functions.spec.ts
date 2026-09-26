import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import { editorLines, setEditorText } from "./helpers/editor";

test("an old unprefixed draft reports the required spelling and becomes executable after correction", async ({
  page,
  request,
}) => {
  const built = await request.post("/api/studio/build", {
    data: {
      source: `
        inputs { ROUND: NUMBER required default 3.6; }
        node input INPUT "Inputs" at (250, 0) { next -> calc; }
        node calc FORMULA "Calculate" at (250, 180) {
          let total = $ROUND(ROUND, 0); next -> out;
        }
        node out OUTPUT "Output" at (250, 360) { return total; }
      `,
    },
  });
  expect(built.ok()).toBeTruthy();
  const definition: Definition = (await built.json()).definition;
  definition.nodes.find((node) => node.id === "calc")!.expression =
    "ROUND(ROUND, 0)";
  const id = `strict-functions-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: id, kind: "FORMULA", definition },
  });
  expect(created.status()).toBe(201);
  const rule: Rule = await created.json();
  const rejected = await request.post(`/api/rules/${id}/publish`, {
    data: { revision: rule.revision },
  });
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).message).toContain("use $ROUND(...)");
  const preview = await request.post("/api/preview", {
    data: { definition, inputs: {} },
  });
  expect(preview.status()).toBe(422);

  await page.goto(`/#/rules/${id}?node=calc`);
  await page
    .getByRole("button", {
      name: "Functions & editor · Expression",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /Expression editor/ });
  await expect(dialog.getByRole("alert")).toContainText(
    "Function calls require a $ prefix; use $ROUND(...)",
  );
  const apply = dialog.getByRole("button", { name: "Apply expression" });
  await expect(apply).toBeDisabled();
  await setEditorText(
    page,
    dialog.getByLabel("Expression code editor", { exact: true }),
    "$ROUND(ROUND, 0)",
  );
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(
    editorLines(page.getByLabel("Expression", { exact: true })),
  ).toHaveText("$ROUND(ROUND, 0)");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved: Rule = await (await request.get(`/api/rules/${id}`)).json();
  expect(saved.draft.inputs[0].name).toBe("ROUND");
  expect(saved.draft.nodes.find((node) => node.id === "calc")?.expression).toBe(
    "$ROUND(ROUND, 0)",
  );
  expect(
    (
      await request.post(`/api/rules/${id}/publish`, {
        data: { revision: saved.revision },
      })
    ).ok(),
  ).toBeTruthy();
  const executed = await request.post(`/api/rules/${id}/execute`, {
    data: { inputs: {} },
  });
  expect(executed.ok()).toBeTruthy();
  expect((await executed.json()).result).toBe(4);
});
