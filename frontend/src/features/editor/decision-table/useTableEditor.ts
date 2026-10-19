import { useReducer } from "react";
import {
  canAddRows,
  emptyRow,
  inserted,
  moved,
  removed,
  withColumnMoved,
  withColumnRemoved,
  withConditionAdded,
  withPastedCells,
  withResultAdded,
  type ColumnSide,
} from "../../../domain/decisionTables";
import type {
  DecisionTable,
  DecisionTableCondition,
  HitPolicy,
} from "../../../types";

/**
 * The table the dialog edits until Apply: its rows carry identities of their
 * own, so a row's cells keep their editors when rows above it are added,
 * moved or removed (lesson F6). Identities count up in the state, which keeps
 * the reducer pure.
 */
export interface TableEditorState {
  table: DecisionTable;
  rowKeys: string[];
  nextKey: number;
  /** What the last paste left out or added, until the next edit. */
  notice: string;
}

export type TableEditorAction =
  | { type: "cell"; key: string; column: number; text: string }
  | {
      type: "condition";
      index: number;
      change: Partial<DecisionTableCondition>;
    }
  | { type: "result"; index: number; name: string }
  | { type: "hitPolicy"; policy: HitPolicy }
  | { type: "addCondition" }
  | { type: "addResult" }
  | { type: "removeColumn"; side: ColumnSide; index: number }
  | { type: "moveColumn"; side: ColumnSide; from: number; to: number }
  | { type: "addRow" }
  | { type: "insertRow"; key: string; below: boolean }
  | { type: "duplicateRow"; key: string }
  | { type: "moveRow"; key: string; by: -1 | 1 }
  | { type: "removeRow"; key: string }
  | { type: "paste"; key: string; column: number; block: string[][] };

function withKeys(state: TableEditorState, count: number) {
  const keys = Array.from(
    { length: count },
    (_, index) => `row-${state.nextKey + index}`,
  );
  return { keys, nextKey: state.nextKey + count };
}

export function reduceTableEditor(
  state: TableEditorState,
  action: TableEditorAction,
): TableEditorState {
  const { table } = state;
  const at = "key" in action ? state.rowKeys.indexOf(action.key) : -1;
  const next = (change: Partial<TableEditorState>): TableEditorState => ({
    ...state,
    notice: "",
    ...change,
  });
  switch (action.type) {
    case "cell": {
      if (at < 0) return state;
      const row = table.rows[at];
      const conditions = table.conditions.length;
      const when = [...row.when];
      const then = [...row.then];
      if (action.column < conditions) {
        if (when[action.column] === action.text) return state;
        when[action.column] = action.text;
      } else {
        if (then[action.column - conditions] === action.text) return state;
        then[action.column - conditions] = action.text;
      }
      const rows = [...table.rows];
      rows[at] = { when, then };
      return next({ table: { ...table, rows } });
    }
    case "condition": {
      const conditions = [...table.conditions];
      conditions[action.index] = {
        ...conditions[action.index],
        ...action.change,
      };
      return next({ table: { ...table, conditions } });
    }
    case "result": {
      const results = [...table.results];
      results[action.index] = { name: action.name };
      return next({ table: { ...table, results } });
    }
    case "hitPolicy":
      return next({ table: { ...table, hitPolicy: action.policy } });
    case "addCondition":
      return next({ table: withConditionAdded(table) });
    case "addResult":
      return next({ table: withResultAdded(table) });
    case "removeColumn":
      return next({
        table: withColumnRemoved(table, action.side, action.index),
      });
    case "moveColumn":
      return next({
        table: withColumnMoved(table, action.side, action.from, action.to),
      });
    case "addRow":
    case "insertRow":
    case "duplicateRow": {
      if (!canAddRows(table)) return state;
      if (action.type !== "addRow" && at < 0) return state;
      let index = table.rows.length;
      if (action.type === "duplicateRow") index = at + 1;
      else if (action.type === "insertRow") index = action.below ? at + 1 : at;
      const row =
        action.type === "duplicateRow" ? table.rows[at] : emptyRow(table);
      const { keys, nextKey } = withKeys(state, 1);
      return next({
        table: { ...table, rows: inserted(table.rows, index, row) },
        rowKeys: inserted(state.rowKeys, index, keys[0]),
        nextKey,
      });
    }
    case "moveRow": {
      const to = at + action.by;
      if (at < 0 || to < 0 || to >= table.rows.length) return state;
      return next({
        table: { ...table, rows: moved(table.rows, at, to) },
        rowKeys: moved(state.rowKeys, at, to),
      });
    }
    case "removeRow":
      if (at < 0) return state;
      return next({
        table: { ...table, rows: removed(table.rows, at) },
        rowKeys: removed(state.rowKeys, at),
      });
    case "paste": {
      if (at < 0) return state;
      const pasted = withPastedCells(table, at, action.column, action.block);
      const { keys, nextKey } = withKeys(state, pasted.addedRows);
      const notes = [
        pasted.addedRows &&
          `${pasted.addedRows} ${pasted.addedRows === 1 ? "row" : "rows"} added`,
        pasted.skippedCells &&
          `${pasted.skippedCells} ${pasted.skippedCells === 1 ? "cell" : "cells"} outside the table left out`,
      ].filter(Boolean);
      return {
        ...state,
        table: pasted.table,
        rowKeys: [...state.rowKeys, ...keys],
        nextKey,
        notice: notes.length ? `Pasted: ${notes.join("; ")}.` : "",
      };
    }
  }
}

/** The editor state of a table as it opens. */
export function tableEditorState(table: DecisionTable): TableEditorState {
  return {
    table,
    rowKeys: table.rows.map((_, index) => `row-${index}`),
    nextKey: table.rows.length,
    notice: "",
  };
}

export function useTableEditor(initial: DecisionTable) {
  return useReducer(reduceTableEditor, initial, tableEditorState);
}
