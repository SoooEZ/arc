import { expect, test } from "@playwright/test";
import {
  reduceTableEditor,
  tableEditorState,
  type TableEditorAction,
  type TableEditorState,
} from "../../src/features/editor/decision-table/useTableEditor";
import { MAX_TABLE_ROWS } from "../../src/domain/limits";
import type { DecisionTable } from "../../src/types";
import { branchBadge } from "../../src/features/execution/ExecutionResult";

const table: DecisionTable = {
  hitPolicy: "FIRST",
  conditions: [{ label: "Tier", expression: "tier" }],
  results: [{ name: "fee" }],
  rows: [
    { when: ['"gold"'], then: ["0"] },
    { when: ["-"], then: ["8"] },
  ],
};

const run = (state: TableEditorState, ...actions: TableEditorAction[]) =>
  actions.reduce(reduceTableEditor, state);

test("rows keep their identities through inserts, moves and removals (F6)", () => {
  const start = tableEditorState(table);
  expect(start.rowKeys).toEqual(["row-0", "row-1"]);
  const edited = run(
    start,
    { type: "insertRow", key: "row-0", below: false },
    { type: "duplicateRow", key: "row-1" },
    { type: "moveRow", key: "row-0", by: 1 },
    { type: "removeRow", key: "row-3" },
  );
  // A new empty row above gold, gold moved below the any-value row, and the
  // any-value row's copy removed: each row kept the identity it started with.
  expect(edited.rowKeys).toEqual(["row-2", "row-1", "row-0"]);
  expect(edited.table.rows).toEqual([
    { when: ["-"], then: [""] },
    { when: ["-"], then: ["8"] },
    { when: ['"gold"'], then: ["0"] },
  ]);
  expect(run(edited, { type: "moveRow", key: "row-2", by: -1 })).toBe(edited);
});

test("a cell edit replaces only its row, and an unchanged value keeps the state", () => {
  const start = tableEditorState(table);
  const edited = run(start, {
    type: "cell",
    key: "row-1",
    column: 1,
    text: "9",
  });
  expect(edited.table.rows[0]).toBe(start.table.rows[0]);
  expect(edited.table.rows[1]).toEqual({ when: ["-"], then: ["9"] });
  expect(
    run(edited, { type: "cell", key: "row-1", column: 1, text: "9" }),
  ).toBe(edited);
  expect(
    run(start, { type: "cell", key: "missing", column: 0, text: "1" }),
  ).toBe(start);
});

test("a paste adds rows with new identities and says what it left out", () => {
  const pasted = run(tableEditorState(table), {
    type: "paste",
    key: "row-1",
    column: 0,
    block: [
      ["silver", "4", "x"],
      ["", "2"],
    ],
  });
  expect(pasted.rowKeys).toEqual(["row-0", "row-1", "row-2"]);
  expect(pasted.table.rows.slice(1)).toEqual([
    { when: ['"silver"'], then: ["4"] },
    { when: ["-"], then: ["2"] },
  ]);
  expect(pasted.notice).toBe(
    "Pasted: 1 row added; 1 cell outside the table left out.",
  );
  // The next edit clears the notice.
  expect(run(pasted, { type: "addRow" }).notice).toBe("");
});

test("rows stop at the limit and columns carry their cells", () => {
  const full = tableEditorState({
    ...table,
    rows: Array.from({ length: MAX_TABLE_ROWS }, () => table.rows[1]),
  });
  expect(run(full, { type: "addRow" })).toBe(full);
  expect(run(full, { type: "duplicateRow", key: "row-0" })).toBe(full);
  const columns = run(
    tableEditorState(table),
    { type: "addCondition" },
    {
      type: "condition",
      index: 1,
      change: { label: "Region", expression: "region" },
    },
    { type: "moveColumn", side: "condition", from: 1, to: 0 },
    { type: "addResult" },
    { type: "result", index: 1, name: "carrier" },
    { type: "hitPolicy", policy: "COLLECT" },
  );
  expect(columns.table.conditions.map((c) => c.label)).toEqual([
    "Region",
    "Tier",
  ]);
  expect(columns.table.rows[0]).toEqual({
    when: ["-", '"gold"'],
    then: ["0", ""],
  });
  expect(columns.table.results).toEqual([{ name: "fee" }, { name: "carrier" }]);
  expect(columns.table.hitPolicy).toBe("COLLECT");
  const fewer = run(columns, {
    type: "removeColumn",
    side: "result",
    index: 0,
  });
  expect(fewer.table.rows[1].then).toEqual([""]);
});

test("a decision table's trace step names the rows that matched", () => {
  const step = {
    ruleId: "r",
    version: null,
    nodeId: "fees",
    label: "Fees",
    type: "DECISION_TABLE" as const,
    value: 8,
    branch: "next",
    depth: 0,
  };
  const definition = { schemaVersion: 1, inputs: [], nodes: [], edges: [] };
  expect(branchBadge({ ...step, matchedRows: [2] }, definition)).toEqual({
    text: "Row 2",
    fallback: false,
  });
  expect(branchBadge({ ...step, matchedRows: [1, 3] }, definition)?.text).toBe(
    "Rows 1, 3",
  );
  expect(branchBadge({ ...step, matchedRows: [] }, definition)?.text).toBe(
    "No row",
  );
  expect(branchBadge(step, definition)).toBeNull();
});
