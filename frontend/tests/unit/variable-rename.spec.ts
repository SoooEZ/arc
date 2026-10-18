import { test, expect } from "@playwright/test";
import type { Definition } from "../../src/types";
import {
  renameVariable,
  variablesRead,
} from "../../src/domain/expressionSymbols";
import {
  canRenameReferences,
  readVariables,
  withRenamedReferences,
} from "../../src/domain/variableRename";
import { recordEdit, noHistory } from "../../src/domain/draftHistory";

const draft: Definition = {
  schemaVersion: 1,
  inputs: [
    { name: "amount", type: "NUMBER", required: true, defaultValue: null },
    {
      name: "taxRate",
      type: "NUMBER",
      required: false,
      defaultValue: null,
      source: {
        id: "country-tax",
        version: 1,
        bindings: { key: "amount" },
        pointer: "/rate",
        onError: "FAIL",
      },
    },
  ],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Large?",
      position: { x: 0, y: 150 },
      expression: 'amount >= 100 && note == "amount"',
    },
    {
      id: "calc",
      type: "FORMULA",
      label: "Discount",
      position: { x: 0, y: 300 },
      expression: "$ROUND(amount * 0.9, 2)",
      output: "total",
    },
    {
      id: "match",
      type: "SWITCH",
      label: "Band",
      position: { x: 0, y: 450 },
      selector: "amount",
      cases: [{ id: "case-1", label: "Hundred", expression: "amount" }],
    },
    {
      id: "shape",
      type: "TRANSFORM",
      label: "Shape",
      position: { x: 0, y: 600 },
      fields: [{ name: "amount", expression: "amount + total" }],
      output: "shaped",
    },
    {
      id: "reuse",
      type: "REFERENCE",
      label: "Reuse",
      position: { x: 0, y: 750 },
      ruleId: "apply-discount",
      version: 1,
      bindings: { amount: "amount", rate: "0.1" },
      output: "price",
    },
    {
      id: "out",
      type: "OUTPUT",
      label: "Out",
      position: { x: 0, y: 900 },
      expression: "total",
    },
  ],
  edges: [],
};

test.describe("renaming a variable in one expression", () => {
  test("rewrites the variable and the root of its property paths", () => {
    expect(renameVariable("amount * rate", "amount", "total")).toBe(
      "total * rate",
    );
    expect(renameVariable("customer.tier == 'gold'", "customer", "buyer")).toBe(
      "buyer.tier == 'gold'",
    );
    expect(renameVariable("amount+amount", "amount", "a")).toBe("a+a");
  });

  test("leaves properties, strings, functions, calls and other names alone", () => {
    for (const expression of [
      "order.amount",
      '"amount" + note',
      "'amount'",
      "$amount(1)",
      "@amount:1(2)",
      "amounts + amount_total",
    ])
      expect(renameVariable(expression, "amount", "total")).toBe(expression);
  });

  test("leaves a collection binder of the same name and the body that reads it", () => {
    expect(
      renameVariable("$MAP(items, amount, amount * 2) + amount", "amount", "x"),
    ).toBe("$MAP(items, amount, amount * 2) + x");
    expect(
      renameVariable("$FILTER(amount, item, item > 1)", "amount", "x"),
    ).toBe("$FILTER(x, item, item > 1)");
  });
});

test.describe("renaming a declared variable across the graph", () => {
  test("rewrites every expression-bearing field and keeps unchanged objects", () => {
    const renamed = withRenamedReferences(draft, "amount", "orderTotal");
    const node = (id: string) => renamed.nodes.find((item) => item.id === id)!;
    expect(node("check").expression).toBe(
      'orderTotal >= 100 && note == "amount"',
    );
    expect(node("calc").expression).toBe("$ROUND(orderTotal * 0.9, 2)");
    expect(node("match").selector).toBe("orderTotal");
    expect(node("match").cases![0].expression).toBe("orderTotal");
    // A Transform field keeps its key; a Reference keeps the callee's parameter names.
    expect(node("shape").fields).toEqual([
      { name: "amount", expression: "orderTotal + total" },
    ]);
    expect(node("reuse").bindings).toEqual({
      amount: "orderTotal",
      rate: "0.1",
    });
    expect(renamed.inputs[1].source!.bindings).toEqual({ key: "orderTotal" });
    // Declarations are the caller's to rename.
    expect(renamed.inputs[0].name).toBe("amount");
    expect(node("out")).toBe(draft.nodes[6]);
    expect(node("input")).toBe(draft.nodes[0]);
  });

  test("returns the same definition when nothing reads the variable", () => {
    expect(withRenamedReferences(draft, "missing", "other")).toBe(draft);
  });

  test("carries references only for a complete name no other declaration uses", () => {
    const input = { input: 0 };
    expect(canRenameReferences(draft, input, "amount", "orderTotal")).toBe(
      true,
    );
    // Incomplete or reserved names, and no change at all.
    expect(canRenameReferences(draft, input, "amount", "")).toBe(false);
    expect(canRenameReferences(draft, input, "amount", "1st")).toBe(false);
    expect(canRenameReferences(draft, input, "amount", "null")).toBe(false);
    expect(canRenameReferences(draft, input, "amount", "amount")).toBe(false);
    // The new name is another input's or another node's result.
    expect(canRenameReferences(draft, input, "amount", "taxRate")).toBe(false);
    expect(canRenameReferences(draft, input, "amount", "total")).toBe(false);
    // A result renamed from the node that declares it.
    expect(
      canRenameReferences(draft, { node: "calc" }, "total", "discounted"),
    ).toBe(true);
    // Two declarations of the old name: its reads may belong to either.
    const shared: Definition = {
      ...draft,
      nodes: draft.nodes.map((node) =>
        node.id === "reuse" ? { ...node, output: "total" } : node,
      ),
    };
    expect(
      canRenameReferences(shared, { node: "calc" }, "total", "discounted"),
    ).toBe(false);
  });

  test("an edit that names its group joins the previous step of that group", () => {
    const renamed = withRenamedReferences(draft, "amount", "a");
    const first = recordEdit(noHistory, draft, renamed, 1000, "input-name:1");
    const second = recordEdit(first, renamed, draft, 1500, "input-name:1");
    expect(second.past).toHaveLength(1);
    const other = recordEdit(first, renamed, draft, 1500, "result-name:calc");
    expect(other.past).toHaveLength(2);
  });
});

test.describe("finding the variables a graph reads", () => {
  test("an expression reads the roots a rename would rewrite, and nothing else", () => {
    expect(variablesRead("amount * rate + customer.tier")).toEqual([
      "amount",
      "rate",
      "customer",
    ]);
    for (const expression of [
      "order.amount",
      '"amount"',
      "$amount(1)",
      "@amount:1(2)",
      "$MAP(items, amount, amount * 2)",
    ])
      expect(variablesRead(expression)).not.toContain("amount");
  });

  test("every expression-bearing field counts, as withRenamedReferences rewrites them", () => {
    const read = readVariables(draft);
    // amount is read by a condition, a formula, a selector, a case, a field,
    // a binding and a source mapping; total and note by a field and a condition.
    for (const name of ["amount", "total", "note"])
      expect(read.has(name)).toBe(true);
    expect(read.has("taxRate")).toBe(false);
    expect(read.has("shaped")).toBe(false);
    // A name each place alone reads is found there.
    const only = (patch: Partial<Definition>): Set<string> =>
      readVariables({ ...draft, ...patch });
    const input = draft.inputs[1];
    expect(only({ nodes: [], inputs: [input] }).has("amount")).toBe(true);
    for (const node of draft.nodes.filter((item) => item.type !== "INPUT")) {
      const renamed = withRenamedReferences(
        { ...draft, nodes: [node], inputs: [] },
        "amount",
        "x",
      );
      expect(
        only({ nodes: [node], inputs: [] }).has("amount"),
        `${node.id} reads amount exactly when a rename rewrites it`,
      ).toBe(renamed.nodes[0] !== node);
    }
  });
});
