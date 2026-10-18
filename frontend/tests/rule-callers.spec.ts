import { expect, test } from "@playwright/test";
import type { Definition, Rule } from "../src/types";
import {
  createRule,
  inputToOutput,
  publishRule,
  uniqueId,
} from "./helpers/api";

const childDefinition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount * 2",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

function callerDefinition(childId: string, version: number): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
      {
        id: "ref",
        type: "REFERENCE",
        label: "Reuse child",
        ruleId: childId,
        version,
        bindings: { amount: "7" },
        output: "answer",
        position: { x: 0, y: 180 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Result",
        expression: "answer",
        position: { x: 0, y: 360 },
      },
    ],
    edges: [
      { id: "start", source: "input", target: "ref", sourceHandle: "next" },
      { id: "end", source: "ref", target: "out", sourceHandle: "next" },
    ],
  };
}

test("rule settings list the rules that call the rule and the versions they run", async ({
  page,
  request,
}) => {
  const id = uniqueId("callers");
  let child: Rule = await createRule(request, {
    id: `${id}-child`,
    name: `Called ${id}`,
    kind: "FORMULA",
    definition: childDefinition,
  });
  child = await publishRule(request, child);
  const caller = await publishRule(
    request,
    await createRule(request, {
      id: `${id}-caller`,
      name: `Caller ${id}`,
      definition: callerDefinition(child.id, 1),
    }),
  );
  child = await publishRule(request, child);

  await page.goto(`/#/rules/${child.id}`);
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  const usedBy = page.getByRole("region", { name: "Used by" });
  const entry = usedBy.getByRole("listitem");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(caller.name);
  await expect(entry).toContainText("Draft uses v1 (v2 is the latest)");
  await expect(entry).toContainText("Published v1 uses v1");

  // Each caller opens in the editor.
  await entry.getByRole("button", { name: caller.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/rules/${caller.id}$`));
  await expect(
    page.getByRole("heading", { name: caller.name, exact: true }),
  ).toBeVisible();

  // A rule nothing calls says so; an unpublished one cannot be called at all.
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Used by" })).toContainText(
    "No other rule calls this rule.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const unpublished = await createRule(request, {
    id: `${id}-draft`,
    definition: inputToOutput,
  });
  await page.goto(`/#/rules/${unpublished.id}`);
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Rule settings" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Used by" })).toHaveCount(0);
});
