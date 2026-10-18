import { test, expect } from "@playwright/test";
import type { Definition } from "../../src/types";
import { nodeErrorsOf } from "../../src/features/editor/useGraphProblems";
import { exampleRule } from "./document-fixtures";

test("node errors use own keys for prototype-named node IDs and ignore child locations of a rule named preview", () => {
  const ids = ["constructor", "toString", "valueOf", "__proto__"];
  const definition: Definition = {
    ...exampleRule().draft,
    nodes: ids.map((id, index) => ({
      id,
      type: "OUTPUT",
      label: id,
      expression: "1",
      position: { x: 0, y: index * 100 },
    })),
    edges: [],
  };
  const errors = nodeErrorsOf({
    shown: { ruleId: "parent", version: null },
    definition,
    problems: [
      {
        message: "Missing value",
        locations: [
          { ruleId: null, version: null, nodeId: "valueOf", label: "v" },
          { ruleId: null, version: null, nodeId: "__proto__", label: "p" },
        ],
      },
      {
        message: "Division by zero",
        locations: [
          { ruleId: "preview", version: 1, nodeId: "toString", label: "c" },
          {
            ruleId: "preview",
            version: null,
            nodeId: "constructor",
            label: "r",
          },
        ],
      },
    ],
    inherited: [],
    invalidDefaults: false,
    nodeCode: null,
  });
  expect([...errors]).toEqual([
    ["valueOf", ["Missing value"]],
    ["__proto__", ["Missing value"]],
    ["constructor", ["Division by zero"]],
  ]);
  expect(errors.get("toString")).toBeUndefined();
  expect(errors.get("hasOwnProperty")).toBeUndefined();
});
