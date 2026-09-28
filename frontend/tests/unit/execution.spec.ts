import { expect, test } from "@playwright/test";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
  sampleInputsJson,
  sampleValue,
  tryParseExecutionInputs,
} from "../../src/domain/executionInputs";
import { DecimalNumber, stringifyJson } from "../../src/domain/json";
import { referenceSnippet } from "../../src/features/studio/snippets";
import type { Definition, Input } from "../../src/types";

const endpoint = "https://arc.example/api/rules/rule/execute";

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
  expect(curlExample(endpoint, { name: "O'Reilly" }, 3)).toContain(
    "O'\\''Reilly",
  );
  expect(curlExample(endpoint, {}, 3)).toContain('"version": 3');
  const configured = curlExample(endpoint, {}, 3, {
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

test("input buffers keep every digit of numbers a double would round", () => {
  const text =
    '{"id":9007199254740993,"x":1e400,"d":0.1000000000000000000001,"plain":1.5}';
  const inputs = parseExecutionInputs(text);
  expect(inputs).toEqual({
    id: new DecimalNumber("9007199254740993"),
    x: new DecimalNumber("1e400"),
    d: new DecimalNumber("0.1000000000000000000001"),
    plain: 1.5,
  });
  // The request body carries the entered tokens; the server decides what it accepts.
  expect(stringifyJson({ inputs })).toBe(`{"inputs":${text}}`);
  expect(() => parseExecutionInputs('{"id":')).toThrow(SyntaxError);
});

test("cURL previews show only JSON-object inputs, with every digit, and quote the endpoint", () => {
  expect(tryParseExecutionInputs('{"id": 9007199254740993}')).toEqual({
    id: new DecimalNumber("9007199254740993"),
  });
  for (const text of ["null", "5", "[1, 2]", '"x"', "{bad", ""]) {
    expect(tryParseExecutionInputs(text), text).toBeNull();
    const command = curlExample(endpoint, tryParseExecutionInputs(text), 3);
    expect(command, text).toContain('"inputs": {}');
  }
  // Callers that still pass an unchecked JSON.parse result get the same guarantee.
  const unchecked = JSON.parse("[1, 2]");
  expect(curlExample(endpoint, unchecked)).toContain('"inputs": {}');

  const exact = curlExample(
    endpoint,
    tryParseExecutionInputs('{"id": 9007199254740993, "rate": 1e400}'),
  );
  expect(exact).toContain('"id": 9007199254740993');
  expect(exact).toContain('"rate": 1e400');
  expect(exact).not.toContain('"version"');
  expect(exact.split("\n")[0]).toBe(`curl -X POST '${endpoint}' \\`);
  expect(curlExample("https://arc.example/it's", {})).toContain(
    "curl -X POST 'https://arc.example/it'\\''s'",
  );
});

test("sample inputs keep big defaults exact in their editable buffer", () => {
  const exact: Definition = {
    ...definition,
    inputs: [
      {
        name: "id",
        type: "NUMBER",
        required: true,
        defaultValue: new DecimalNumber("9007199254740993"),
      },
      {
        name: "limits",
        type: "ARRAY",
        required: true,
        defaultValue: [new DecimalNumber("12345678901234567890"), 2],
      },
      { name: "rate", type: "NUMBER", required: true, defaultValue: null },
    ],
  };
  expect(sampleInputsJson(exact)).toBe(
    '{\n  "id": 9007199254740993,\n  "limits": [\n    12345678901234567890,\n    2\n  ],\n  "rate": 0.1\n}',
  );
  expect(sampleInputsJson(definition)).toBe(
    JSON.stringify(sampleInputs(definition), null, 2),
  );
});

test("rule inputs and source parameters share typed sample values", () => {
  const parameter = (
    name: string,
    type: Input["type"],
    defaultValue: unknown = null,
  ): Input => ({ name, type, required: true, defaultValue });
  for (const [input, value] of [
    [parameter("amount", "NUMBER"), 150],
    [parameter("rate", "NUMBER"), 0.1],
    [parameter("customerTier", "STRING"), "premium"],
    [parameter("key", "STRING"), "US"],
    [parameter("name", "STRING"), "example"],
    [parameter("enabled", "BOOLEAN"), true],
    [parameter("items", "ARRAY"), []],
    [parameter("customer", "OBJECT"), {}],
    [parameter("amount", "NUMBER", 0), 0],
    [parameter("enabled", "BOOLEAN", false), false],
    [parameter("name", "STRING", ""), ""],
    // Placeholders are looked up by own names only.
    [parameter("constructor", "STRING"), "example"],
    [parameter("toString", "NUMBER"), 150],
  ] as const)
    expect(sampleValue(input), input.name).toEqual(value);
});
