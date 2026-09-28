import { expect, test } from "@playwright/test";
import {
  comparisonText,
  literalText,
  quoteText,
  simpleComparison,
} from "../../src/domain/expressions";
import { trimAsServer } from "../../src/domain/serverText";
import { literalCases } from "./literal-cases";

test("graph string constants preserve the standard JSON string value", () => {
  const text = 'A "quoted" \\ path\b\f\n\r\t\u0000 · 中文 · 😀';
  expect(quoteText(text)).toBe(JSON.stringify(text));
  expect(literalText(JSON.stringify(text))).toBe(text);
  expect(literalText(String.raw`"\u0041\u4e2d\uD83D\uDE00\b\f"`)).toBe(
    "A中😀\b\f",
  );
  expect(literalText(String.raw`"\\u0041"`)).toBe(String.raw`\u0041`);
});

test("graph string constants retain ARC single quotes and legacy unknown escapes", () => {
  expect(literalText(String.raw`'it\'s "ARC" \u0041\b\f\q'`)).toBe(
    'it\'s "ARC" A\b\fq',
  );
  expect(literalText(String.raw`"it\'s \q"`)).toBe("it's q");
  expect(literalText("'first\nsecond\tline'")).toBe("first\nsecond\tline");
});

test("malformed Unicode strings stay expressions instead of becoming altered constants", () => {
  for (const value of [
    String.raw`"\u"`,
    String.raw`"\u123"`,
    String.raw`"\u12xz"`,
    String.raw`'\u12xz'`,
    String.raw`"\u\n00"`,
    '"unfinished',
    '"first" + "second"',
    "SUM(amount)",
  ]) {
    expect(literalText(value), value).toBeNull();
  }
});

test("string constants decode exactly the literals the server reads, and nothing else", () => {
  for (const { text, constant, value } of literalCases)
    expect(literalText(trimAsServer(text)), JSON.stringify(text)).toBe(
      constant === "STRING" ? value : null,
    );
});

test("expression text is trimmed like the server's String.trim, not Unicode whitespace", () => {
  expect(trimAsServer("\u0000\t 1 + 2 \r\n\u0001")).toBe("1 + 2");
  expect(trimAsServer("\u00a0 1 \u2028")).toBe("\u00a0 1 \u2028");
  expect(trimAsServer("\ufeff1")).toBe("\ufeff1");
});

test("comparisonText parenthesizes operands whose top-level operators bind no tighter than the comparison", () => {
  // Stored as flag == a || b, the server read (flag == a) || b (lesson: X59).
  expect(comparisonText("flag", "==", "a || b")).toBe("flag == (a || b)");
  expect(comparisonText("a || b", "==", "false")).toBe("(a || b) == false");
  expect(comparisonText(" a AND b ", "!=", "x == y")).toBe(
    "(a AND b) != (x == y)",
  );
  expect(comparisonText('"a" OR b', "==", "[1] AND c")).toBe(
    '("a" OR b) == ([1] AND c)',
  );
  // The keywords are upper-case; `and` is an identifier and `AND(…)` a call,
  // which the builder used to wrap and then refuse to read back.
  expect(comparisonText(" a and b ", "!=", "x")).toBe("a and b != x");
  expect(simpleComparison("$AND(a, b) == true")).toEqual([
    "$AND(a, b) == true",
    "$AND(a, b)",
    "==",
    "true",
  ]);
  expect(simpleComparison("AND(a, b) == x + OR(c)")).toEqual([
    "AND(a, b) == x + OR(c)",
    "AND(a, b)",
    "==",
    "x + OR(c)",
  ]);
  expect(simpleComparison("a AND(b) == c")).toBeNull();
  expect(comparisonText("amount", ">", "limit >= 1")).toBe(
    "amount > (limit >= 1)",
  );
  for (const atom of [
    "amount",
    "order.total",
    "$ROUND(x, 2)",
    '"a || b"',
    "'x == y'",
    "[1, 2]",
    "(a || b)",
    "-5",
    "android",
    "ORDER",
    "x.OR",
    "$AND(a, b)",
    "AND(a, b)",
    // An open quote is still being typed.
    "'a",
  ])
    expect(comparisonText(atom, "==", "1"), atom).toBe(`${atom} == 1`);
  // The builder reads its own text back with the same operands.
  for (const text of [
    "flag == (a || b)",
    "(a || b) == false",
    "amount > (limit >= 1)",
  ]) {
    const [, left, operator, right] = simpleComparison(text)!;
    expect(comparisonText(left, operator, right), text).toBe(text);
  }
});
