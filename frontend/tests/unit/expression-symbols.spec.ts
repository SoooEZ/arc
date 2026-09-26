import { expect, test } from "@playwright/test";
import { expressionSymbols } from "../../src/domain/expressionSymbols";
import type { VariableOption } from "../../src/domain/graph";

const variables: VariableOption[] = [
  { name: "ROUND", type: "NUMBER", label: "Inputs" },
  { name: "amount", type: "NUMBER", label: "Inputs" },
  { name: "items", type: "ARRAY", label: "Inputs" },
  { name: "customer", type: "OBJECT", label: "Inputs" },
  { name: "price", type: "RESULT", label: "Calculate" },
];
function names(source: string, script = false) {
  return expressionSymbols(source, variables, script).map((symbol) => ({
    text: source.slice(symbol.offset, symbol.offset + symbol.length),
    kind: symbol.kind,
  }));
}

test("colors names by role without confusing same-name calls, properties, strings or comments", () => {
  expect(
    names(
      '$ROUND(ROUND, 2) + price + customer.amount + "amount price" // $ROUND(price)',
    ),
  ).toEqual([
    { text: "$ROUND", kind: "function" },
    { text: "ROUND", kind: "parameter" },
    { text: "price", kind: "variable" },
    { text: "customer", kind: "parameter" },
  ]);
  expect(names("$NORM.S.DIST(amount, true) + ROUND + ROUND(amount)")).toEqual([
    { text: "$NORM.S.DIST", kind: "function" },
    { text: "amount", kind: "parameter" },
    { text: "ROUND", kind: "parameter" },
    { text: "ROUND", kind: "function" },
    { text: "amount", kind: "parameter" },
  ]);
});

test("collection locals shadow inputs only in their bodies, including nested and incomplete calls", () => {
  expect(
    names(
      "$MAP(items, amount, $MAP(amount, price, amount + price)) + amount + price",
    ),
  ).toEqual([
    { text: "$MAP", kind: "function" },
    { text: "items", kind: "parameter" },
    { text: "amount", kind: "variable.local" },
    { text: "$MAP", kind: "function" },
    { text: "amount", kind: "variable.local" },
    { text: "price", kind: "variable.local" },
    { text: "amount", kind: "variable.local" },
    { text: "price", kind: "variable.local" },
    { text: "amount", kind: "parameter" },
    { text: "price", kind: "variable" },
  ]);
  expect(
    names("$REDUCE(items, amount, price, amount + price, price + amount)"),
  ).toEqual([
    { text: "$REDUCE", kind: "function" },
    { text: "items", kind: "parameter" },
    { text: "amount", kind: "variable.local" },
    { text: "price", kind: "variable.local" },
    { text: "amount", kind: "parameter" },
    { text: "price", kind: "variable" },
    { text: "price", kind: "variable.local" },
    { text: "amount", kind: "variable.local" },
  ]);
  expect(names("$FILTER(items, customer, customer.amount > amount")).toEqual([
    { text: "$FILTER", kind: "function" },
    { text: "items", kind: "parameter" },
    { text: "customer", kind: "variable.local" },
    { text: "customer", kind: "variable.local" },
    { text: "amount", kind: "parameter" },
  ]);
});

test("numeric property paths color only their input or local root, not same-named result properties", () => {
  expect(
    names("items.0.price + $MAP(items, item, item.0.price) + price"),
  ).toEqual([
    { text: "items", kind: "parameter" },
    { text: "$MAP", kind: "function" },
    { text: "items", kind: "parameter" },
    { text: "item", kind: "variable.local" },
    { text: "item", kind: "variable.local" },
    { text: "price", kind: "variable" },
  ]);
});

test("script declarations and expression bodies color references but not node IDs, bindings or JSON", () => {
  expect(
    names(
      `schema 1;
inputs { amount: NUMBER required; return: NUMBER optional; source amount = {"id":"price","version":1}; }
node amount FORMULA "price" at (0, 0) { let total = $ROUND(amount, 2); next -> price; }
node "reuse" REFERENCE "Reuse" { bind amount = total; as price; }
node "out" OUTPUT "Output" { return return + price; }`,
      true,
    ),
  ).toEqual([
    { text: "amount", kind: "parameter" },
    { text: "return", kind: "parameter" },
    { text: "amount", kind: "parameter" },
    { text: "total", kind: "variable" },
    { text: "$ROUND", kind: "function" },
    { text: "amount", kind: "parameter" },
    { text: "total", kind: "variable" },
    { text: "price", kind: "variable" },
    { text: "return", kind: "parameter" },
    { text: "price", kind: "variable" },
  ]);
});
