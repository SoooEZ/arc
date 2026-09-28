import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";
import { createRule, uniqueId } from "./helpers/api";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 10 },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 0, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "amount / 3",
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

test("preview results and trace values show every decimal digit without JSON.rawJSON", async ({
  page,
  request,
}) => {
  // Engines without JSON.rawJSON stringify a DecimalNumber as a string.
  await page.addInitScript(() => {
    Reflect.deleteProperty(JSON, "rawJSON");
  });
  const id = uniqueId("result-display");
  await createRule(request, {
    id,
    name: "Exact result display",
    kind: "FORMULA",
    definition,
  });
  const exact = "3.333333333333333333333333333333333";
  const large = "12345678901234567890";
  await page.route("**/api/preview", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: `{"ruleId":"${id}","version":null,"result":${exact},"durationMicros":10,"trace":[{"ruleId":"${id}","version":null,"nodeId":"out","label":"Result","type":"OUTPUT","value":${large},"branch":null,"depth":0}]}`,
    }),
  );
  await page.goto(`/#/rules/${id}`);
  await page.getByRole("button", { name: "Test rule", exact: true }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page.getByTestId("test-result")).toHaveText(exact);
  await expect(page.locator(".trace-list code")).toHaveText(large);
});
