import { test, expect } from "@playwright/test";
import type { Definition } from "../../src/types";
import { connectGraphNodes, patchGraphNode } from "../../src/domain/graph";
import {
  availableVariables,
  declaredVariables,
  inputVariables,
  variableOptionLabel,
} from "../../src/domain/variables";
import { exampleRule } from "./document-fixtures";

test("variable choices only include guaranteed inputs and upstream results and combine their labels", () => {
  let definition = exampleRule().draft;
  expect(
    availableVariables(definition, "output", ["amount", "price"]),
  ).toContainEqual({
    name: "price",
    type: "RESULT",
    label: "First calculation",
  });
  definition = connectGraphNodes(definition, "right", "output", "next", "join");
  expect(
    availableVariables(definition, "output", ["amount", "price"]).find(
      (value) => value.name === "price",
    )?.label,
  ).toBe("First calculation / Second calculation");
  expect(
    availableVariables(definition, "output", ["amount"]).map(
      (value) => value.name,
    ),
  ).toEqual(["amount"]);
  expect(availableVariables(definition, "output", [])).toEqual([]);
});

test("disconnected nodes and unresolved scope reads do not inherit graph inputs", () => {
  const definition = exampleRule().draft;
  expect(availableVariables(definition, "right", [])).toEqual([]);
  expect(availableVariables(definition, "right")).toEqual([]);
  expect(availableVariables(definition, "output")).toEqual([]);
  expect(availableVariables(definition, "input", ["amount"])).toEqual(
    inputVariables(definition),
  );
  expect(inputVariables(definition)).toEqual([
    { name: "amount", type: "NUMBER", label: "Input" },
  ]);
});

test("variable labels follow producer renames while merged results keep their identity and unknown type", () => {
  const definition = connectGraphNodes(
    exampleRule().draft,
    "right",
    "output",
    "next",
    "join",
  );
  const scope = ["amount", "price"];
  const before = availableVariables(definition, "output", scope);
  const renamed = patchGraphNode(
    patchGraphNode(definition, "input", { label: "Customer inputs" }),
    "left",
    { label: "Compute price" },
  );
  const options = availableVariables(renamed, "output", scope);
  expect(options.map(({ name, type }) => ({ name, type }))).toEqual(
    before.map(({ name, type }) => ({ name, type })),
  );
  expect(options.map(variableOptionLabel)).toEqual([
    "amount [number] from Customer inputs",
    "price [result] from Compute price / Second calculation",
  ]);
  expect(inputVariables(renamed)[0].label).toBe("Customer inputs");
});

test("declared variables list a name assigned by several nodes once, with every producer", () => {
  // Code studio completion listed price twice, once per producing node.
  expect(declaredVariables(exampleRule().draft)).toEqual([
    { name: "amount", type: "NUMBER", label: "Input" },
    {
      name: "price",
      type: "RESULT",
      label: "First calculation / Second calculation",
    },
  ]);
  const fees: Definition = {
    schemaVersion: 1,
    inputs: [],
    edges: [],
    nodes: ["High fee", "Low fee", "High fee"].map((label, index) => ({
      id: `fee${index}`,
      type: "FORMULA",
      label,
      expression: "1",
      output: "fee",
      position: { x: 0, y: 0 },
    })),
  };
  expect(declaredVariables(fees)).toEqual([
    { name: "fee", type: "RESULT", label: "High fee / Low fee" },
  ]);
});
