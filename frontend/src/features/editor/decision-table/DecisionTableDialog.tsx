import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import { Plus, X } from "lucide-react";
import { useStagedDialogEdits } from "../../../app/navigationGuards";
import {
  canAddCondition,
  canAddResult,
  canAddRows,
  hitPolicies,
  hitPolicyLabel,
  tableStructureProblem,
  testCellProblems,
} from "../../../domain/decisionTables";
import {
  MAX_TABLE_CONDITIONS,
  MAX_TABLE_RESULTS,
  MAX_TABLE_ROWS,
} from "../../../domain/limits";
import { counted } from "../../../domain/text";
import type { VariableOption } from "../../../domain/variables";
import type { DecisionTable, HitPolicy } from "../../../types";
import ColumnPanel from "./ColumnPanel";
import TableCheckList from "./TableCheckList";
import TableGrid, { type SelectedColumn } from "./TableGrid";
import { useTableEditor } from "./useTableEditor";

/** An Add button that says why it is off at a limit. */
function AddButton({
  label,
  limit,
  allowed,
  onClick,
}: {
  label: string;
  limit: string;
  allowed: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={allowed ? "" : `A table holds at most ${limit}.`}>
      <span>
        <Button
          size="small"
          startIcon={<Plus size={14} />}
          disabled={!allowed}
          onClick={onClick}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}

/**
 * The decision table of one node, edited as a grid until Apply to graph.
 * Read-only versions open it to read the whole table.
 */
export default function DecisionTableDialog({
  table: initial,
  nodeLabel,
  readOnly,
  variables,
  scopeKnown,
  onApply,
  onClose,
}: {
  table: DecisionTable;
  nodeLabel: string;
  readOnly: boolean;
  variables: VariableOption[];
  scopeKnown: boolean;
  onApply: (table: DecisionTable) => void;
  onClose: () => void;
}) {
  const [state, dispatch] = useTableEditor(initial);
  const { table } = state;
  const changed = table !== initial;
  // Staged edits ask before Escape, the backdrop or a route change drops them.
  const dismiss = useStagedDialogEdits(changed && !readOnly, onClose);
  const [selected, setSelected] = useState<SelectedColumn | null>(null);
  const fullScreen = useMediaQuery("(max-width: 700px)");
  // Problems read the rows and the number of conditions, never their names,
  // so renaming a column does not parse every cell again.
  const { rows } = table;
  const conditionCount = table.conditions.length;
  const problems = useMemo(
    () => testCellProblems(rows, conditionCount),
    [rows, conditionCount],
  );
  const invalidCells = problems.flat().filter(Boolean).length;
  const structure = tableStructureProblem(table);
  const canAddRow = canAddRows(table);
  const title = `${readOnly ? "Decision table" : "Edit decision table"} · ${nodeLabel}`;
  return (
    <Dialog
      open
      onClose={readOnly ? onClose : dismiss}
      fullWidth
      maxWidth="xl"
      fullScreen={fullScreen}
      className="decision-table-dialog"
      aria-labelledby="decision-table-title"
    >
      <DialogTitle className="decision-table-title" component="div">
        <h2 id="decision-table-title">{title}</h2>
        <Tooltip title={readOnly ? "Close" : "Close without applying"}>
          <IconButton aria-label="Close table editor" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent className="decision-table-content">
        <div className="decision-table-toolbar">
          <TextField
            select
            size="small"
            fullWidth={false}
            label="Matching"
            value={table.hitPolicy ?? "FIRST"}
            disabled={readOnly}
            onChange={(event) =>
              dispatch({
                type: "hitPolicy",
                policy: event.target.value as HitPolicy,
              })
            }
          >
            {hitPolicies.map((policy) => (
              <MenuItem key={policy} value={policy}>
                {hitPolicyLabel(policy)}
              </MenuItem>
            ))}
          </TextField>
          {!readOnly && (
            <>
              <AddButton
                label="Add condition"
                limit={counted(MAX_TABLE_CONDITIONS, "condition")}
                allowed={canAddCondition(table)}
                onClick={() => {
                  dispatch({ type: "addCondition" });
                  setSelected({
                    side: "condition",
                    index: table.conditions.length,
                  });
                }}
              />
              <AddButton
                label="Add result"
                limit={counted(MAX_TABLE_RESULTS, "result")}
                allowed={canAddResult(table)}
                onClick={() => {
                  dispatch({ type: "addResult" });
                  setSelected({ side: "result", index: table.results.length });
                }}
              />
              <AddButton
                label="Add row"
                limit={counted(MAX_TABLE_ROWS, "row")}
                allowed={canAddRow}
                onClick={() => dispatch({ type: "addRow" })}
              />
            </>
          )}
          <span className="decision-table-counts">
            {counted(table.rows.length, "row")}
            {invalidCells > 0 && ` · ${counted(invalidCells, "cell")} to fix`}
          </span>
        </div>
        {selected && (
          <ColumnPanel
            table={table}
            column={selected}
            readOnly={readOnly}
            variables={variables}
            scopeKnown={scopeKnown}
            dispatch={dispatch}
            onSelect={setSelected}
            onDone={() => setSelected(null)}
          />
        )}
        <div className="decision-table-scroll">
          <TableGrid
            table={table}
            rowKeys={state.rowKeys}
            problems={problems}
            readOnly={readOnly}
            canAddRow={canAddRow}
            selected={selected}
            onSelect={setSelected}
            dispatch={dispatch}
          />
          {!table.rows.length && (
            <p className="decision-table-empty">
              No rows yet. Add a row, or paste rows from a spreadsheet into a
              cell.
            </p>
          )}
        </div>
        {state.notice && (
          <p className="decision-table-notice" role="status">
            {state.notice}
          </p>
        )}
        <p className="decision-table-help">
          A test is a value (<code>"gold"</code>, <code>100</code>,{" "}
          <code>true</code>, <code>null</code>), a comparison (
          <code>&gt;= 100</code>, <code>!= "x"</code>), a range (
          <code>100..&lt;500</code>), a list (<code>"a", "b"</code>),{" "}
          <code>not(…)</code> or <code>-</code> for any value; plain text is
          quoted for you. Results are expressions, so text needs quotes. Paste a
          block copied from a spreadsheet into any cell.
        </p>
        <section
          className="decision-table-check-panel"
          aria-label="Table check"
        >
          <h3>Table check</h3>
          <TableCheckList table={table} />
        </section>
      </DialogContent>
      <DialogActions className="decision-table-actions">
        {!readOnly && structure && (
          <span className="decision-table-structure" role="alert">
            {structure}
          </span>
        )}
        <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={!!structure}
            onClick={() => {
              if (changed) onApply(table);
              onClose();
            }}
          >
            Apply to graph
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
