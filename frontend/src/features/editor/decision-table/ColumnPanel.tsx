import type { Dispatch } from "react";
import { Button, TextField } from "@mui/material";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import ExpressionField from "../../expressions/ExpressionField";
import {
  conditionLabelProblem,
  resultNameProblem,
} from "../../../domain/decisionTables";
import { acceptsIdentifierEdit } from "../../../domain/identifiers";
import { MAX_LABEL_CHARACTERS } from "../../../domain/limits";
import type { VariableOption } from "../../../domain/variables";
import type { DecisionTable } from "../../../types";
import type { SelectedColumn } from "./TableGrid";
import type { TableEditorAction } from "./useTableEditor";

/**
 * The selected column's settings: a condition's name and the value its rows
 * test, or a result's name, with the column's moves and its removal.
 */
export default function ColumnPanel({
  table,
  column,
  readOnly,
  variables,
  scopeKnown,
  dispatch,
  onSelect,
  onDone,
}: {
  table: DecisionTable;
  column: SelectedColumn;
  readOnly: boolean;
  variables: VariableOption[];
  scopeKnown: boolean;
  dispatch: Dispatch<TableEditorAction>;
  onSelect: (column: SelectedColumn | null) => void;
  onDone: () => void;
}) {
  const { side, index } = column;
  const count =
    side === "condition" ? table.conditions.length : table.results.length;
  const move = (to: number) => {
    dispatch({ type: "moveColumn", side, from: index, to });
    onSelect({ side, index: to });
  };
  const actions = (
    <div className="decision-table-column-actions">
      {!readOnly && (
        <>
          <Button
            size="small"
            startIcon={<ArrowLeft size={14} />}
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            Move left
          </Button>
          <Button
            size="small"
            startIcon={<ArrowRight size={14} />}
            disabled={index === count - 1}
            onClick={() => move(index + 1)}
          >
            Move right
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<Trash2 size={14} />}
            onClick={() => {
              dispatch({ type: "removeColumn", side, index });
              onSelect(null);
            }}
          >
            {side === "condition" ? "Delete condition" : "Delete result"}
          </Button>
        </>
      )}
      <Button size="small" onClick={onDone}>
        Done
      </Button>
    </div>
  );
  if (side === "condition") {
    const condition = table.conditions[index];
    const problem = conditionLabelProblem(table, index);
    return (
      <section
        className="decision-table-column-panel"
        aria-label={`Condition ${index + 1} settings`}
      >
        <TextField
          label="Condition name"
          size="small"
          value={condition.label}
          disabled={readOnly}
          error={!!problem}
          helperText={
            problem ?? "The grid and run errors name the column by it."
          }
          slotProps={{ htmlInput: { maxLength: MAX_LABEL_CHARACTERS } }}
          onChange={(event) =>
            dispatch({
              type: "condition",
              index,
              change: { label: event.target.value },
            })
          }
        />
        <ExpressionField
          label="Value to test"
          value={condition.expression}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={readOnly}
          helperText="Evaluated once per run; each row tests this value."
          onChange={(expression) =>
            dispatch({ type: "condition", index, change: { expression } })
          }
        />
        {actions}
      </section>
    );
  }
  const result = table.results[index];
  const problem = resultNameProblem(table, index);
  return (
    <section
      className="decision-table-column-panel"
      aria-label={`Result ${index + 1} settings`}
    >
      <TextField
        label="Result name"
        size="small"
        value={result.name}
        disabled={readOnly}
        error={!!problem}
        helperText={
          problem ??
          "With several results, the value is an object keyed by these names."
        }
        onChange={(event) => {
          if (acceptsIdentifierEdit(result.name, event.target.value))
            dispatch({ type: "result", index, name: event.target.value });
        }}
      />
      {actions}
    </section>
  );
}
