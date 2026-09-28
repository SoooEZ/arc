import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";

// Node IDs are case-sensitive, and the renderer hoists notes above every node.
const definition: Definition = {
  schemaVersion: 1,
  notes: ['node "calc" is legacy; keep until Q3'],
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "calc",
      type: "FORMULA",
      label: "Legacy calc",
      expression: "1",
      output: "total",
      position: { x: 0, y: 150 },
    },
    {
      id: "Output",
      type: "OUTPUT",
      label: "Upper output",
      expression: "total",
      position: { x: -150, y: 300 },
    },
    {
      id: "output",
      type: "OUTPUT",
      label: "Lower output",
      expression: "total + 1",
      position: { x: 150, y: 300 },
    },
  ],
  edges: [
    { id: "start", source: "input", target: "calc", sourceHandle: "next" },
    { id: "upper", source: "calc", target: "Output", sourceHandle: "next" },
    { id: "lower", source: "calc", target: "output", sourceHandle: "next" },
  ],
};

test("outline navigation reveals the exact node declaration, not a comment or a case variant", async ({
  page,
  request,
}) => {
  const id = `studio-outline-${Date.now()}`;
  const created = await request.post("/api/rules", {
    data: { id, name: "Outline fixture", kind: "FORMULA", definition },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto(`/#/studio/${id}`);
  const code = page.locator(".view-lines");
  await expect(code).toContainText('node "output" OUTPUT "Lower output"');
  const outline = page.locator(".studio-outline");

  // Typing a marker shows where navigation placed the cursor.
  await outline.getByRole("button").filter({ hasText: "Lower output" }).click();
  await page.keyboard.type("X");
  await expect(code).toContainText('Xnode "output" OUTPUT "Lower output"');
  await expect(code).toContainText('node "Output" OUTPUT "Upper output"');

  await outline.getByRole("button").filter({ hasText: "Legacy calc" }).click();
  await page.keyboard.type("Y");
  await expect(code).toContainText('Ynode "calc" FORMULA "Legacy calc"');
  await expect(code).toContainText('// node "calc" is legacy');

  await outline.getByRole("button").filter({ hasText: "Upper output" }).click();
  await page.keyboard.type("Z");
  await expect(code).toContainText('Znode "Output" OUTPUT "Upper output"');
});
