import { expect, test } from "@playwright/test";
import {
  MAX_PUBLISHED_VERSION,
  formulaReference,
  parseFormulaReference,
  parsePublishedVersion,
} from "../../src/domain/formulaReferences";
import { expressionSymbols } from "../../src/domain/expressionSymbols";
import { MAX_RESOURCE_ID_CHARACTERS } from "../../src/domain/limits";

const longest = "a".repeat(MAX_RESOURCE_ID_CHARACTERS);

test("a Formula call names a rule ID and a version as the server reads them", () => {
  expect(parseFormulaReference("@tax-rate:3")).toEqual({
    id: "tax-rate",
    version: 3,
  });
  expect(parseFormulaReference(`@${longest}:1`)).toEqual({
    id: longest,
    version: 1,
  });
  expect(parseFormulaReference(`@tax:${MAX_PUBLISHED_VERSION}`)).toEqual({
    id: "tax",
    version: MAX_PUBLISHED_VERSION,
  });
  // Hovering a version past the server's int sent a read it answered with 400.
  for (const text of [
    "@Tax-Rate:3",
    "@tax_rate:3",
    "@1tax:3",
    "@tax-rate:0",
    "@tax-rate:03",
    "@tax-rate",
    "@tax-rate:",
    "@tax-rate:3 ",
    `@${longest}a:1`,
    "@tax-rate:2147483648",
    "@tax-rate:99999999999999999999",
    "tax-rate:3",
  ])
    expect(parseFormulaReference(text), text).toBeNull();
  expect(formulaReference("tax-rate", 3)).toBe("@tax-rate:3");
});

test("a route's version is read within the same bound", () => {
  expect(parsePublishedVersion("7")).toBe(7);
  expect(parsePublishedVersion("2147483647")).toBe(2147483647);
  for (const text of [null, "", "0", "07", "2147483648", "1e1", "-2", " 7"])
    expect(parsePublishedVersion(text), String(text)).toBeNull();
});

/** The Formula references the lexer colors in `source`. */
function formulaTokens(source: string): string[] {
  return expressionSymbols(source, [])
    .filter((symbol) => symbol.kind === "formula")
    .map((symbol) =>
      source.slice(symbol.offset, symbol.offset + symbol.length),
    );
}

// The lexer, the editor's word pattern and the hover compose one grammar: an
// uppercase ID is no reference, a zero version is not part of one, and an ID
// stops at the server's length limit.
test("symbol coloring reads a Formula reference in the server's grammar", () => {
  expect(formulaTokens("@tax-rate:3(1) + @draft(2)")).toEqual([
    "@tax-rate:3",
    "@draft",
  ]);
  expect(formulaTokens("@Tax:1(1)")).toEqual([]);
  expect(formulaTokens("@tax:0(1)")).toEqual(["@tax"]);
  expect(formulaTokens(`@${longest}:1(1)`)).toEqual([`@${longest}:1`]);
  expect(formulaTokens(`@${longest}a:1(1)`)).toEqual([`@${longest}`]);
});
