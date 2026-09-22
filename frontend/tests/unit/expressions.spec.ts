import { expect, test } from "@playwright/test";
import { literalText, quoteText } from "../../src/domain/expressions";

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
