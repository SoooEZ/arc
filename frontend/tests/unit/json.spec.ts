import { expect, test } from "@playwright/test";
import {
  DecimalNumber,
  isDecimalNumber,
  isJsonObject,
  parseJson,
  parseJsonObject,
  sameDecimalValue,
  sameJsonNumber,
  stringifyJson,
} from "../../src/domain/json";

const inexactNumbers = [
  "9007199254740993",
  "-9007199254740993",
  "12345678901234567890",
  "100000000000000000001",
  "0.12345678901234567890123",
  "0.30000000000000000001",
  "1.7976931348623159e308",
  "1e400",
  "-1E+400",
  "1e-400",
];

test("numbers that keep their decimal value as doubles stay numbers", () => {
  for (const [token, value] of [
    ["0", 0],
    ["-1", -1],
    ["0.1", 0.1],
    ["1.0", 1],
    ["1E2", 100],
    ["123.456e-2", 1.23456],
    ["9007199254740992", 9007199254740992],
    ["100000000000000000000", 1e20],
    ["1e21", 1e21],
    ["5e-324", 5e-324],
    ["1.7976931348623157e308", Number.MAX_VALUE],
  ] as const)
    expect(parseJson(token), token).toBe(value);
  // Equal decimal values keep their value but not their spelling.
  expect(stringifyJson(parseJson("[1.0,1E2,-0]"))).toBe("[1,100,0]");
  expect(Object.is(parseJson("-0"), -0)).toBe(true);
  expect(Object.is(parseJson("-0.0e5"), -0)).toBe(true);
});

test("numbers a double would change become DecimalNumber and keep their token", () => {
  for (const token of inexactNumbers) {
    const value = parseJson(token);
    expect(isDecimalNumber(value), token).toBe(true);
    expect(String(value)).toBe(token);
    expect(stringifyJson(value)).toBe(token);
    expect(stringifyJson([value, { value }])).toBe(
      `[${token},{"value":${token}}]`,
    );
  }
  expect(parseJson("1e400")).not.toBe(Infinity);
  expect(stringifyJson(parseJson("[1e400,-1e400]"))).toBe("[1e400,-1e400]");
});

test("documents with inexact numbers round trip exactly, compact and indented", () => {
  const compact =
    '{"id":9007199254740993,"rate":0.12345678901234567890123,"items":[12345678901234567890,1e400,{"deep":[[-9007199254740993]]}],"plain":1.5,"text":"9007199254740993"}';
  const document = parseJson(compact);
  expect(stringifyJson(document)).toBe(compact);
  const indented = [
    "{",
    '  "id": 9007199254740993,',
    '  "items": [',
    "    1e400,",
    "    {",
    '      "deep": 0.30000000000000000001',
    "    }",
    "  ]",
    "}",
  ].join("\n");
  expect(stringifyJson(parseJson(indented), 2)).toBe(indented);
  expect(parseJson(compact)).toMatchObject({ plain: 1.5 });
});

test("valid documents parse like JSON.parse, including whitespace, escapes and unicode", () => {
  for (const text of [
    ' \t\n\r[ 1 , { "a" : "b" } , [ ] , { } ]\n',
    '"\\u00e9\\n\\t\\r\\b\\f\\"\\\\\\/"',
    '"\\ud83d\\ude00 and 😀"',
    '"\\ud800 lone \udc00 surrogates"',
    '"line separator"',
    '"a\\u0000b"',
    '{"":1,"b":2,"a":3,"1":4}',
    '{"a":1,"a":2}',
    "[[[[]]],{},[{}]]",
    "true",
    "false",
    "null",
    '[-0.5e-3,0E0,1e+2,"x"]',
    "  42  ",
  ]) {
    const expected: unknown = JSON.parse(text);
    expect(parseJson(text), text).toEqual(expected);
    expect(JSON.stringify(parseJson(text)), text).toBe(
      JSON.stringify(expected),
    );
  }
});

test("__proto__ keys become own properties, as with JSON.parse", () => {
  const text =
    '{"__proto__":{"polluted":true},"nested":{"__proto__":[1]},"after":2}';
  const value = parseJson(text);
  if (!isJsonObject(value)) throw new Error("Expected an object");
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.hasOwn(value, "__proto__")).toBe(true);
  expect(value.polluted).toBeUndefined();
  expect(Object.keys(value)).toEqual(Object.keys(JSON.parse(text)));
  expect(stringifyJson(value)).toBe(text);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("invalid documents throw SyntaxError like JSON.parse", () => {
  for (const text of [
    "",
    " ",
    "[",
    "{",
    "]",
    "[1,]",
    "[,1]",
    "[1 2]",
    '{"a":1,}',
    '{"a" 1}',
    '{"a":}',
    "{a:1}",
    "{'a':1}",
    '{"a":1}x',
    "01",
    "+1",
    ".5",
    "1.",
    "1e",
    "1e+",
    "-",
    "--1",
    "0x10",
    "NaN",
    "Infinity",
    "undefined",
    "tru",
    "nul",
    "True",
    "1 2",
    " 1",
    "﻿1",
    '"unterminated',
    '"\\"',
    '"\\x"',
    '"\\u12"',
    '"\\u12G4"',
    '"raw\ttab"',
    '"raw\nnewline"',
    '"\\\n"',
    "'single'",
  ]) {
    expect(() => JSON.parse(text), text).toThrow(SyntaxError);
    expect(() => parseJson(text), text).toThrow(SyntaxError);
  }
});

test("deep nesting does not exhaust the call stack", () => {
  const depth = 100_000;
  let value = parseJson("[".repeat(depth) + "]".repeat(depth));
  let levels = 0;
  while (Array.isArray(value) && value.length) {
    value = value[0];
    levels++;
  }
  expect(levels).toBe(depth - 1);
});

test("stringifyJson matches JSON.stringify for values without DecimalNumber", () => {
  const values: unknown[] = [
    {
      name: 'quote " backslash \\ slash / control \u0001 line  ',
      emoji: "😀",
      lone: "\ud800",
      numbers: [0, -0, 1.5, 1e21, 5e-324, NaN, Infinity, -Infinity],
      flags: [true, false, null],
      nested: { empty: {}, list: [], deeper: [{ a: [1, [2, [3]]] }] },
      omitted: undefined,
      method() {
        return 1;
      },
      holes: [undefined, () => 1],
      date: new Date(0),
      custom: { toJSON: () => ({ replaced: true }) },
      marker: "arc-decimal-0",
    },
    [],
    {},
    "text",
    42,
    null,
    true,
  ];
  for (const value of values)
    for (const space of [undefined, 0, 2, 4, 20])
      expect(stringifyJson(value, space)).toBe(
        JSON.stringify(value, null, space),
      );
  expect(stringifyJson(undefined)).toBe(JSON.stringify(undefined));
});

test("stringifyJson writes DecimalNumber tokens without relying on JSON.rawJSON", () => {
  const value = {
    id: new DecimalNumber("9007199254740993"),
    list: [new DecimalNumber("1e400")],
  };
  const rawJSON: unknown = Reflect.get(JSON, "rawJSON");
  if (typeof rawJSON === "function")
    expect(JSON.stringify(value)).toBe(
      '{"id":9007199254740993,"list":[1e400]}',
    );
  Reflect.deleteProperty(JSON, "rawJSON");
  try {
    expect(stringifyJson(value, 2)).toBe(
      '{\n  "id": 9007199254740993,\n  "list": [\n    1e400\n  ]\n}',
    );
    // Without JSON.rawJSON, plain JSON.stringify keeps the digits as a string.
    expect(JSON.stringify(value)).toBe(
      '{"id":"9007199254740993","list":["1e400"]}',
    );
  } finally {
    if (rawJSON !== undefined) Reflect.set(JSON, "rawJSON", rawJSON);
  }
});

test("a string that contains the replacement marker is not replaced", () => {
  const random = Math.random;
  let calls = 0;
  // Force the first marker so that the value contains it.
  Math.random = () => (calls++ === 0 ? 0.5 : random());
  const marker = `arc-decimal-${(0.5).toString(36).slice(2)}-`;
  try {
    const value = {
      text: `${marker}0`,
      key: { [`${marker}0`]: 1 },
      exact: new DecimalNumber("9007199254740993"),
    };
    expect(stringifyJson(value)).toBe(
      `{"text":"${marker}0","key":{"${marker}0":1},"exact":9007199254740993}`,
    );
  } finally {
    Math.random = random;
  }
});

test("DecimalNumber accepts only JSON number tokens", () => {
  expect(new DecimalNumber("-1.5e-7").text).toBe("-1.5e-7");
  for (const text of ["", "1.", ".5", "+1", "01", "1e", "NaN", "1 ", "0x1"])
    expect(() => new DecimalNumber(text), text).toThrow(SyntaxError);
});

test("JSON object helpers exclude arrays, null and DecimalNumber", () => {
  expect(parseJsonObject('{"a":1e400}', "Need an object")).toEqual({
    a: new DecimalNumber("1e400"),
  });
  for (const text of ["[]", "null", "1", '"text"', "9007199254740993"])
    expect(() => parseJsonObject(text, "Need an object"), text).toThrow(
      new Error("Need an object"),
    );
  expect(() => parseJsonObject("{", "Need an object")).toThrow(SyntaxError);
  expect(isJsonObject({})).toBe(true);
  for (const value of [null, [], new DecimalNumber("1"), "a", 1])
    expect(isJsonObject(value)).toBe(false);
});

test("decimal comparison ignores spelling but not rounding, overflow or underflow", () => {
  for (const [text, value] of [
    ["1.50e1", 15],
    ["+001.2300", 1.23],
    [".5", 0.5],
    ["5.", 5],
    ["-0", -0],
    ["0.000", 0],
    ["1e21", 1e21],
  ] as const)
    expect(sameDecimalValue(text, value), text).toBe(true);
  for (const [text, value] of [
    ["9007199254740993", 9007199254740992],
    ["1e-400", 0],
    ["0.1", 0.2],
    ["1e400", Infinity],
    ["abc", Number.NaN],
    [".", 0],
  ] as const)
    expect(sameDecimalValue(text, value), text).toBe(false);
});

test("JSON numbers compare by decimal value across doubles and DecimalNumber", () => {
  const exact = new DecimalNumber("9007199254740993");
  for (const [left, right] of [
    [exact, new DecimalNumber("9007199254740993")],
    [new DecimalNumber("1.50e1"), new DecimalNumber("15.0")],
    [new DecimalNumber("1e400"), new DecimalNumber("10E+399")],
    [new DecimalNumber("1.5"), 1.5],
    [1.5, new DecimalNumber("15e-1")],
    [-0, 0],
    [0.1, 0.1],
  ] as const)
    expect(sameJsonNumber(left, right), `${left} ${right}`).toBe(true);
  for (const [left, right] of [
    [exact, new DecimalNumber("9007199254740992")],
    [exact, 9007199254740992],
    [9007199254740992, exact],
    [new DecimalNumber("1e400"), Infinity],
    [0.1, 0.2],
    [Number.NaN, Number.NaN],
  ] as const)
    expect(sameJsonNumber(left, right), `${left} ${right}`).toBe(false);
});

test("a 1 MiB document parses in reasonable time", () => {
  const rows = [];
  for (let index = 0; rows.length < 6_000; index++)
    rows.push({
      id: `row-${index}`,
      label: `Row ${index} é "quoted" \\ ${"x".repeat(40)}`,
      amount: index * 1.25,
      flags: [index % 2 === 0, null, index],
      nested: { depth: [index, [index + 0.5]], note: "😀" },
    });
  const text = JSON.stringify(rows, null, 2);
  expect(text.length).toBeGreaterThan(1024 * 1024);
  const started = performance.now();
  const parsed = parseJson(text);
  const elapsed = performance.now() - started;
  expect(parsed).toEqual(JSON.parse(text));
  expect(elapsed).toBeLessThan(1_000);
});
