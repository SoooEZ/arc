import { expect, test } from "@playwright/test";
import {
  formulaSnippet,
  formulaSignature,
  type FormulaEntry,
} from "../../src/features/studio/formulaCalls";
import { expressionSymbols } from "../../src/domain/expressionSymbols";
const formula: FormulaEntry = {
  id: "price-with-tax",
  name: "Price with tax",
  version: 3,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    { name: "rate", type: "NUMBER", required: false, defaultValue: 0.1 },
  ],
};
test("formula snippets pin versions and preserve omitted trailing defaults", () => {
  expect(formulaSnippet(formula, ["amount"])).toBe(
    "@price-with-tax:3(${1:amount})",
  );
  expect(formulaSnippet(formula, ["amount", "rate"])).toBe(
    "@price-with-tax:3(${1:amount}, ${2:rate})",
  );
  expect(formulaSignature(formula)).toBe(
    "@price-with-tax:3(amount: number, rate: number)",
  );
});
test("middle formula defaults escape Monaco metacharacters and retain ARC object construction", () => {
  const snippet = formulaSnippet(
    {
      ...formula,
      inputs: [
        {
          name: "settings",
          type: "OBJECT",
          required: false,
          defaultValue: { price$: ["$100", "${1:literal}", "C:\\temp"] },
        },
        formula.inputs[0],
      ],
    },
    ["amount"],
  );
  expect(snippet).toContain(
    '\\$OBJECT("price\\$", ["\\$100", "\\${1:literal\\}", "C:',
  );
  expect(snippet).toContain("${2:amount}");
});
test("formula tokens do not consume arguments or literal at signs", () => {
  const source =
    '@price-with-tax:3(amount) + $ROUND(amount, 2) + "@other:4(amount)" // @ignored:1(amount)';
  const symbols = expressionSymbols(source, [
    { name: "amount", type: "NUMBER", label: "Inputs" },
  ]);
  expect(
    symbols.map((symbol) => [
      source.slice(symbol.offset, symbol.offset + symbol.length),
      symbol.kind,
    ]),
  ).toEqual([
    ["@price-with-tax:3", "formula"],
    ["amount", "parameter"],
    ["$ROUND", "function"],
    ["amount", "parameter"],
  ]);
});
