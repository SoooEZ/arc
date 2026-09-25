import { expect, test } from "@playwright/test";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../../src/domain/executionInputs";
import { referenceSnippet } from "../../src/features/studio/snippets";
import type { Definition } from "../../src/types";

const definition: Definition = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: 0 },
    { name: "enabled", type: "BOOLEAN", required: true, defaultValue: false },
    { name: "optional", type: "STRING", required: false, defaultValue: null },
    {
      name: "remote",
      type: "NUMBER",
      required: true,
      defaultValue: null,
      source: {
        id: "tax",
        version: 1,
        pointer: "",
        bindings: {},
        onError: "FAIL",
      },
    },
  ],
};

test("execution examples preserve falsy defaults and let sourced inputs resolve remotely", () => {
  expect(sampleInputs(definition)).toEqual({ amount: 0, enabled: false });
  expect(parseExecutionInputs('{"amount":null}')).toEqual({ amount: null });
  for (const text of ["null", "[]", "1", '"text"'])
    expect(() => parseExecutionInputs(text)).toThrow(
      "Inputs must be a JSON object",
    );
  expect(
    curlExample("https://arc.example", "rule", { name: "O'Reilly" }, 3),
  ).toContain("O'\\''Reilly");
  expect(curlExample("https://arc.example", "rule", {}, 3)).toContain(
    '"version": 3',
  );
  const configured = curlExample("https://arc.example", "rule", {}, 3, {
    trace: false,
    timeoutMs: 5000,
  });
  expect(configured).toContain('"trace": false');
  expect(configured).toContain('"timeoutMs": 5000');
});

test("reference snippets map caller inputs, pin the fetched version, and omit defaulted or sourced arguments", () => {
  const child: Definition = {
    ...definition,
    inputs: [
      ...definition.inputs,
      { name: "customer", type: "STRING", required: true, defaultValue: null },
      { name: "shared", type: "NUMBER", required: true, defaultValue: null },
    ],
  };
  const caller: Definition = {
    ...definition,
    inputs: [
      { name: "shared", type: "NUMBER", required: true, defaultValue: null },
    ],
  };
  const snippet = referenceSnippet(
    { id: "child", name: "Child" },
    { ruleId: "child", version: 3, definition: child, publishedAt: "" },
    caller,
    "reuse-child",
  );
  expect(snippet).toContain('use "child" version 3;');
  expect(snippet).toContain('bind customer = "value";');
  expect(snippet).toContain("bind shared = shared;");
  for (const omitted of ["remote", "amount", "enabled", "optional"])
    expect(snippet).not.toContain(`bind ${omitted}`);
  expect(snippet).toContain("${1:reusedResult}");
});
