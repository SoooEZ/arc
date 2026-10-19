import {
  memo,
  useCallback,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
} from "react";
import { IconButton, Menu, MenuItem, Tooltip } from "@mui/material";
import { EllipsisVertical } from "lucide-react";
import {
  committedTestCell,
  isTabularText,
  parseTabularText,
  type ColumnSide,
} from "../../../domain/decisionTables";
import type { DecisionTable, DecisionTableRow } from "../../../types";
import type { TableEditorAction } from "./useTableEditor";

export interface SelectedColumn {
  side: ColumnSide;
  index: number;
}

interface CellProps {
  rowKey: string;
  rowIndex: number;
  /** Conditions first, then results. */
  column: number;
  kind: "test" | "result";
  value: string;
  problem: string | null;
  labelledBy: string;
  readOnly: boolean;
  dispatch: Dispatch<TableEditorAction>;
  focusCell: (row: number, column: number) => void;
}

/**
 * One cell. The text being typed stays here until the cell is left, Enter is
 * pressed or a block is pasted, so typing renders this input alone (F39).
 */
const TableCell = memo(function TableCell({
  rowKey,
  rowIndex,
  column,
  kind,
  value,
  problem,
  labelledBy,
  readOnly,
  dispatch,
  focusCell,
}: CellProps) {
  // The stored value it started from: a new stored value (a paste, an undo
  // of the dialog's own edits) replaces the typed text.
  const [draft, setDraft] = useState({ base: value, text: value });
  const text = draft.base === value ? draft.text : value;
  const commit = () => {
    const committed = kind === "test" ? committedTestCell(text) : text.trim();
    setDraft({ base: committed, text: committed });
    if (committed !== value)
      dispatch({ type: "cell", key: rowKey, column, text: committed });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      focusCell(rowIndex + (event.shiftKey ? -1 : 1), column);
    } else if (event.key === "Escape" && text !== value) {
      // Escape takes back the typing; the dialog stays open.
      event.stopPropagation();
      setDraft({ base: value, text: value });
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text/plain");
    if (readOnly || !isTabularText(pasted)) return;
    event.preventDefault();
    dispatch({
      type: "paste",
      key: rowKey,
      column,
      block: parseTabularText(pasted),
    });
  };
  // A problem belongs to the stored text; typing hides it until the cell is left.
  const shown = text === value ? problem : null;
  return (
    <input
      className={`table-cell-input decision-table-cell ${kind === "result" ? "decision-table-result-cell" : ""} ${shown ? "table-cell-invalid" : ""}`}
      data-cell={`${rowIndex}:${column}`}
      aria-labelledby={labelledBy}
      aria-invalid={!!shown}
      title={shown ?? undefined}
      value={text}
      readOnly={readOnly}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft({ base: value, text: event.target.value })}
      onBlur={() => {
        if (!readOnly) commit();
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
});

interface RowProps {
  gridId: string;
  rowKey: string;
  index: number;
  row: DecisionTableRow;
  problems: readonly (string | null)[];
  readOnly: boolean;
  canAddRow: boolean;
  last: boolean;
  dispatch: Dispatch<TableEditorAction>;
  focusCell: (row: number, column: number) => void;
}

function RowActions({
  rowKey,
  index,
  canAddRow,
  last,
  dispatch,
}: Pick<RowProps, "rowKey" | "index" | "canAddRow" | "last" | "dispatch">) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const act = (action: TableEditorAction) => {
    setAnchor(null);
    dispatch(action);
  };
  return (
    <>
      <Tooltip title="Row actions">
        <IconButton
          size="small"
          aria-label={`Row ${index + 1} actions`}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <EllipsisVertical size={15} />
        </IconButton>
      </Tooltip>
      {anchor && (
        <Menu open anchorEl={anchor} onClose={() => setAnchor(null)}>
          <MenuItem
            disabled={!canAddRow}
            onClick={() =>
              act({ type: "insertRow", key: rowKey, below: false })
            }
          >
            Insert row above
          </MenuItem>
          <MenuItem
            disabled={!canAddRow}
            onClick={() => act({ type: "insertRow", key: rowKey, below: true })}
          >
            Insert row below
          </MenuItem>
          <MenuItem
            disabled={!canAddRow}
            onClick={() => act({ type: "duplicateRow", key: rowKey })}
          >
            Duplicate row
          </MenuItem>
          <MenuItem
            disabled={index === 0}
            onClick={() => act({ type: "moveRow", key: rowKey, by: -1 })}
          >
            Move up
          </MenuItem>
          <MenuItem
            disabled={last}
            onClick={() => act({ type: "moveRow", key: rowKey, by: 1 })}
          >
            Move down
          </MenuItem>
          <MenuItem onClick={() => act({ type: "removeRow", key: rowKey })}>
            Delete row
          </MenuItem>
        </Menu>
      )}
    </>
  );
}

function sameRow(before: RowProps, after: RowProps): boolean {
  return (
    before.row === after.row &&
    before.rowKey === after.rowKey &&
    before.index === after.index &&
    before.readOnly === after.readOnly &&
    before.canAddRow === after.canAddRow &&
    before.last === after.last &&
    before.gridId === after.gridId &&
    before.dispatch === after.dispatch &&
    before.focusCell === after.focusCell &&
    before.problems.length === after.problems.length &&
    before.problems.every((problem, index) => problem === after.problems[index])
  );
}

/**
 * A row renders again only when its cells, its problems or its place change:
 * renaming a column or typing in another row leaves it alone (F39).
 */
const TableRowView = memo(function TableRowView({
  gridId,
  rowKey,
  index,
  row,
  problems,
  readOnly,
  canAddRow,
  last,
  dispatch,
  focusCell,
}: RowProps) {
  const rowHeader = `${gridId}-row-${rowKey}`;
  const cell = (column: number, kind: "test" | "result", value: string) => (
    <td key={column}>
      <TableCell
        rowKey={rowKey}
        rowIndex={index}
        column={column}
        kind={kind}
        value={value}
        problem={kind === "test" ? (problems[column] ?? null) : null}
        labelledBy={`${rowHeader} ${gridId}-column-${column}`}
        readOnly={readOnly}
        dispatch={dispatch}
        focusCell={focusCell}
      />
    </td>
  );
  return (
    <tr data-row={index + 1}>
      <th scope="row" id={rowHeader} className="decision-table-number">
        <span className="visually-hidden">Row </span>
        {index + 1}
      </th>
      {row.when.map((value, column) => cell(column, "test", value))}
      <td className="decision-table-arrow" aria-hidden>
        →
      </td>
      {row.then.map((value, column) =>
        cell(row.when.length + column, "result", value),
      )}
      <td className="decision-table-row-actions">
        {!readOnly && (
          <RowActions
            rowKey={rowKey}
            index={index}
            canAddRow={canAddRow}
            last={last}
            dispatch={dispatch}
          />
        )}
      </td>
    </tr>
  );
}, sameRow);

export default function TableGrid({
  table,
  rowKeys,
  problems,
  readOnly,
  canAddRow,
  selected,
  onSelect,
  dispatch,
}: {
  table: DecisionTable;
  rowKeys: readonly string[];
  problems: readonly (readonly (string | null)[])[];
  readOnly: boolean;
  canAddRow: boolean;
  selected: SelectedColumn | null;
  onSelect: (column: SelectedColumn) => void;
  dispatch: Dispatch<TableEditorAction>;
}) {
  const gridId = useId();
  const grid = useRef<HTMLTableElement>(null);
  const focusCell = useCallback((row: number, column: number) => {
    grid.current
      ?.querySelector<HTMLInputElement>(`[data-cell="${row}:${column}"]`)
      ?.focus();
  }, []);
  const conditions = table.conditions.length;
  const heading = (
    side: ColumnSide,
    index: number,
    name: string,
    detail: string | null,
  ) => {
    const column = side === "condition" ? index : conditions + index;
    const active = selected?.side === side && selected.index === index;
    return (
      <th
        key={column}
        scope="col"
        className={`decision-table-heading-cell decision-table-${side}${active ? " decision-table-selected" : ""}`}
      >
        <button
          type="button"
          className="decision-table-heading"
          aria-pressed={active}
          aria-label={`${side === "condition" ? "Condition" : "Result"} ${name || index + 1}: edit column`}
          onClick={() => onSelect({ side, index })}
        >
          <span id={`${gridId}-column-${column}`}>
            {side === "result" && (
              <span className="visually-hidden">result </span>
            )}
            {name || <em>unnamed</em>}
          </span>
          {detail !== null && <code>{detail || "…"}</code>}
        </button>
      </th>
    );
  };
  return (
    <table className="decision-table-grid" ref={grid}>
      <thead>
        <tr>
          <th scope="col" className="decision-table-number">
            #
          </th>
          {table.conditions.map((condition, index) =>
            heading("condition", index, condition.label, condition.expression),
          )}
          <th className="decision-table-arrow" aria-hidden>
            →
          </th>
          {table.results.map((result, index) =>
            heading("result", index, result.name, null),
          )}
          <th className="decision-table-row-actions">
            <span className="visually-hidden">Row actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, index) => (
          <TableRowView
            key={rowKeys[index]}
            gridId={gridId}
            rowKey={rowKeys[index]}
            index={index}
            row={row}
            problems={problems[index] ?? []}
            readOnly={readOnly}
            canAddRow={canAddRow}
            last={index === table.rows.length - 1}
            dispatch={dispatch}
            focusCell={focusCell}
          />
        ))}
      </tbody>
    </table>
  );
}
