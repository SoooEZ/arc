import { MenuItem, TextField } from "@mui/material";
import { shortId } from "../../../domain/ids";
import {
  branchMode,
  canBranchTrueFalse,
  withBranchMode,
  type BranchMode,
} from "../../../domain/switchBranches";
import type { NodeFieldsProps } from "./types";

const modes: readonly { value: BranchMode; label: string }[] = [
  { value: "true-false", label: "True / False" },
  { value: "conditions", label: "Cases · first true case" },
  { value: "value", label: "Match a value" },
];

/**
 * How the Condition node branches. Choosing another mode converts the node
 * between True / False and cases and keeps its connections (withBranchMode).
 */
export default function BranchModeField({
  node,
  readOnly,
  onDefinitionChange,
}: Pick<NodeFieldsProps, "node" | "readOnly" | "onDefinitionChange">) {
  const trueFalse = canBranchTrueFalse(node);
  const change = (value: string) => {
    const mode = modes.find((option) => option.value === value)?.value;
    if (!mode) return;
    // Document updaters can run more than once, so the case ID is chosen here.
    const caseId = shortId("case-");
    onDefinitionChange((definition) =>
      withBranchMode(definition, node.id, mode, caseId),
    );
  };
  return (
    <TextField
      select
      label="Branches"
      value={branchMode(node)}
      disabled={readOnly}
      helperText={
        trueFalse
          ? undefined
          : "True / False takes a single case checked as a condition."
      }
      onChange={(event) => change(event.target.value)}
    >
      {modes.map(({ value, label }) => (
        <MenuItem
          key={value}
          value={value}
          disabled={value === "true-false" && !trueFalse}
        >
          {label}
        </MenuItem>
      ))}
    </TextField>
  );
}
