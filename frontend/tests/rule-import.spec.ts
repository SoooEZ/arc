import { expect, test, type Locator, type Page } from "@playwright/test";
import { deleteRule, inputToOutput, readRule, uniqueId } from "./helpers/api";

/** A default whose digits a double would round (lossless-numbers.spec.ts). */
const exactDigits = "0.07000000000000000001";
/** inputToOutput as Export definition writes it, with that number as written. */
const exportedText = JSON.stringify(inputToOutput, null, 2).replace(
  '"defaultValue": 10',
  `"defaultValue": ${exactDigits}`,
);

/** The Create rule dialog switched to start from a graph file. */
async function openImport(page: Page) {
  await page.goto("/#/library");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Create a rule" });
  await dialog.getByRole("button", { name: "Graph file", exact: true }).click();
  return dialog;
}

/** Chooses a file with this name and text in the dialog's file field. */
async function chooseFile(dialog: Locator, name: string, text: string) {
  await dialog.getByLabel("Graph file").evaluate(
    (element, chosen) => {
      const files = new DataTransfer();
      files.items.add(
        new File([chosen.text], chosen.name, { type: "application/json" }),
      );
      (element as HTMLInputElement).files = files.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { name, text },
  );
}

test("a graph exported from ARC creates a rule with that draft, digits included", async ({
  page,
  request,
}) => {
  const id = uniqueId("imported");
  const dialog = await openImport(page);
  const create = dialog.getByRole("button", {
    name: "Create rule",
    exact: true,
  });
  await expect(create).toBeDisabled();

  // A file that is not a graph says so and creates nothing.
  await chooseFile(dialog, "notes.json", '{"title":"not a graph"}');
  await expect(dialog.getByRole("alert")).toContainText(
    "This file holds no ARC graph",
  );
  await expect(create).toBeDisabled();
  await chooseFile(dialog, "broken.json", '{"nodes": [');
  await expect(dialog.getByRole("alert")).toContainText(
    "This file is not JSON",
  );

  // The exported file's name suggests the rule's name, and its ID follows.
  expect(exportedText).toContain(exactDigits);
  await chooseFile(dialog, "tax-calculator-v3.json", exportedText);
  await expect(
    dialog.getByText("2 nodes · 1 input · 1 connection"),
  ).toBeVisible();
  await expect(dialog.getByLabel("Rule name", { exact: true })).toHaveValue(
    "Tax calculator",
  );
  await expect(dialog.getByLabel("Rule ID", { exact: true })).toHaveValue(
    "tax-calculator",
  );
  await dialog.getByLabel("Rule ID", { exact: true }).fill(id);
  await create.click();

  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
  await expect(
    page.getByText("Rule imported from tax-calculator-v3.json."),
  ).toBeVisible();
  const created = await readRule(request, id);
  expect(created.publishedVersion).toBeNull();
  expect(created.draft.edges).toEqual(inputToOutput.edges);
  // Read as text: JSON.parse would round the stored number.
  const stored = await (await request.get(`/api/rules/${id}`)).text();
  expect(stored).toContain(`"defaultValue":${exactDigits}`);
  await deleteRule(request, id);
});

test("a rule or version read from the API imports its graph, and a taken ID is refused in the dialog", async ({
  page,
  request,
}) => {
  const id = uniqueId("imported-wrapped");
  const dialog = await openImport(page);
  // GET /api/rules/{id} holds the graph as draft.
  await chooseFile(
    dialog,
    "rule.json",
    JSON.stringify({
      id: "elsewhere",
      name: "Elsewhere",
      draft: inputToOutput,
    }),
  );
  await expect(
    dialog.getByText("2 nodes · 1 input · 1 connection"),
  ).toBeVisible();
  await dialog.getByLabel("Rule name", { exact: true }).fill(`Wrapped ${id}`);
  await dialog.getByLabel("Rule ID", { exact: true }).fill(id);
  await dialog
    .getByRole("button", { name: "Create rule", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));

  // Importing again under the same ID keeps the dialog open with the server's reason.
  const again = await openImport(page);
  await chooseFile(
    again,
    "version.json",
    JSON.stringify({ ruleId: id, version: 1, definition: inputToOutput }),
  );
  await again.getByLabel("Rule name", { exact: true }).fill("Again");
  await again.getByLabel("Rule ID", { exact: true }).fill(id);
  await again.getByRole("button", { name: "Create rule", exact: true }).click();
  await expect(again.getByRole("alert")).toContainText("already exists");
  await expect(again).toBeVisible();
  await deleteRule(request, id);
});

test("Template stays the default start, with its sample graph", async ({
  page,
}) => {
  await page.goto("/#/library");
  await page
    .getByRole("button", { name: "Create rule", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Create a rule" });
  await expect(
    dialog.getByRole("button", { name: "Template", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByText("Includes a connected graph and sample inputs"),
  ).toBeVisible();
  await expect(dialog.getByLabel("Graph file")).toHaveCount(0);
});
