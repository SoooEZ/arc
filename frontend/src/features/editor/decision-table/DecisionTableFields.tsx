import { useMemo, useState } from "react";
import { Button, MenuItem, TextField } from "@mui/material";
import { TableProperties } from "lucide-react";
import {
  decisionTableSummary,
  hitPolicies,
  hitPolicyLabel,
  testCellProblems,
} from "../../../domain/decisionTables";
import { counted } from "../../../domain/text";
import type { DecisionTable, HitPolicy } from "../../../types";
import InspectorSection from "../inspector/InspectorSection";
import type { NodeFieldsProps } from "../inspector/types";
import DecisionTableDialog from "./DecisionTableDialog";
import TableCheckList from "./TableCheckList";
import TablePreview from "./TablePreview";

const policyHelp: Record<HitPolicy, string> = {
  FIRST:
    "Rows are tried from the top; the first row that matches gives the result. A run that matches no row fails.",
  UNIQUE:
    "Exactly one row may match. A run that matches no row, or more than one, fails.",
  COLLECT:
    "Every matching row gives a value, in table order: the result is a list, empty when no row matches.",
};

/**
 * A decision table node's form: the table's summary and first rows, the grid
 * editor behind Edit table, how matching rows give the value, and the table
 * check's hints. Save result as follows, as for every kind that stores one.
 */
export default function DecisionTableFields({
  node,
  patch,
  readOnly,
  variables,
  scopeKnown,
}: NodeFieldsProps) {
  const [editing, setEditing] = useState(false);
  const table = node.table;
  const invalidCells = useMemo(
    () =>
      table
        ? testCellProblems(table.rows, table.conditions.length)
            .flat()
            .filter(Boolean).length
        : 0,
    [table],
  );
  const policy = table?.hitPolicy ?? "FIRST";
  const write = (next: DecisionTable) => patch({ table: next });
  return (
    <>
      <InspectorSection
        title="Table"
        count={table?.rows.length}
        help="Each row tests the condition values and gives the result values. Edit table opens the whole grid; paste rows from a spreadsheet there."
      >
        <p className="muted-copy">{decisionTableSummary(table, node.output)}</p>
        {table && <TablePreview table={table} />}
        {invalidCells > 0 && (
          <p className="decision-table-problem">
            {counted(invalidCells, "cell")}{" "}
            {invalidCells === 1 ? "needs" : "need"} a valid test.
          </p>
        )}
        <Button
          variant="outlined"
          startIcon={<TableProperties size={15} />}
          disabled={!table}
          onClick={() => setEditing(true)}
        >
          {readOnly ? "View table" : "Edit table…"}
        </Button>
      </InspectorSection>
      <InspectorSection
        title="Matching"
        help="Which rows give the table's value when several rows match, and what happens when none does."
      >
        <TextField
          select
          label="Matching"
          value={policy}
          disabled={readOnly || !table}
          onChange={(event) =>
            table &&
            write({ ...table, hitPolicy: event.target.value as HitPolicy })
          }
        >
          {hitPolicies.map((option) => (
            <MenuItem key={option} value={option}>
              {hitPolicyLabel(option)}
            </MenuItem>
          ))}
        </TextField>
        <p className="muted-copy">{policyHelp[policy]}</p>
      </InspectorSection>
      {table && (
        <InspectorSection
          title="Table check"
          help="Rows that never match, rows that match the same values in a one-match table, and values no row matches. Null values are not checked. Hints never block saving or publishing."
        >
          <TableCheckList table={table} />
        </InspectorSection>
      )}
      {editing && table && (
        <DecisionTableDialog
          table={table}
          nodeLabel={node.label}
          readOnly={readOnly}
          variables={variables}
          scopeKnown={scopeKnown}
          onApply={write}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
