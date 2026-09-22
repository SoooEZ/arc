import { useState } from "react";
import { MenuItem, TextField } from "@mui/material";
import type { InputType } from "../../types";

import type { VariableOption } from "../../domain/graph";
import {
  constantDefaults,
  inferBindingMode,
  inferConstantType,
  isBindingConstant,
  type BindingMode,
  type ConstantType,
} from "../../domain/valueBinding";
import ExpressionField from "./ExpressionField";
import ConstantValueField from "./ConstantValueField";
export default function ValueBinding({
  label,
  type,
  value,
  variables,
  disabled,
  onChange,
  optional = true,
  helperText,
}: {
  label: string;
  type: InputType | "ANY";
  value?: string;
  variables: VariableOption[];
  disabled: boolean;
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  helperText?: string;
}) {
  const [chosenMode, setChosenMode] = useState<BindingMode | null>(null);
  const [chosenType, setChosenType] = useState<ConstantType | null>(null);
  const inferredType = inferConstantType(value ?? "");
  const effectiveType =
    type === "ANY" ? (chosenType ?? inferredType ?? "NUMBER") : type;
  const isConstant = isBindingConstant(value ?? "", type);
  const mode =
    chosenMode ??
    inferBindingMode(
      value,
      isConstant,
      variables.map((variable) => variable.name),
    );
  const choices = variables.filter(
    (v) => type === "ANY" || v.type === type || v.type === "RESULT",
  );
  const chooseMode = (next: BindingMode) => {
    setChosenMode(next);
    if (next === "default") onChange(undefined);
    else if (next === "variable") {
      if (!choices.some((v) => v.name === value)) onChange(undefined);
    } else if (next === "constant") {
      if (type === "ANY") {
        const nextType = inferredType ?? chosenType ?? "NUMBER";
        setChosenType(nextType);
        if (inferredType === null) onChange(constantDefaults[nextType]);
      } else if (!isConstant) {
        const nextType = type === "OBJECT" ? "ARRAY" : type;
        onChange(constantDefaults[nextType]);
      }
    }
  };
  return (
    <div className="value-binding">
      <TextField
        select
        label={`${label} · value source`}
        value={mode}
        disabled={disabled}
        onChange={(e) => chooseMode(e.target.value as BindingMode)}
      >
        <MenuItem value="variable">Upstream variable</MenuItem>
        {type !== "OBJECT" && <MenuItem value="constant">Constant</MenuItem>}
        <MenuItem value="expression">Expression</MenuItem>
        {optional && <MenuItem value="default">Use default / omit</MenuItem>}
      </TextField>
      {mode === "constant" && type === "ANY" && (
        <TextField
          select
          label="Constant type"
          value={effectiveType}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as ConstantType;
            setChosenType(next);
            onChange(constantDefaults[next]);
          }}
        >
          {(["NUMBER", "STRING", "BOOLEAN", "ARRAY", "NULL"] as const).map(
            (t) => (
              <MenuItem key={t} value={t}>
                {t.toLowerCase()}
              </MenuItem>
            ),
          )}
        </TextField>
      )}
      {mode === "constant" && (
        <ConstantValueField
          label={label}
          type={effectiveType}
          value={value}
          disabled={disabled}
          helperText={helperText}
          onChange={onChange}
        />
      )}
      {mode === "variable" && (
        <TextField
          select
          label={label}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
          helperText={helperText || "Inputs and results available at this node"}
        >
          <MenuItem value="">Select a variable</MenuItem>
          {!!value && !choices.some((v) => v.name === value) && (
            <MenuItem value={value} disabled>
              {value} · unavailable
            </MenuItem>
          )}
          {choices.map((v) => (
            <MenuItem key={v.name} value={v.name}>
              {v.name} · {v.label}
            </MenuItem>
          ))}
        </TextField>
      )}
      {mode === "expression" && (
        <ExpressionField
          label={label}
          value={value ?? ""}
          variables={variables}
          disabled={disabled}
          onChange={(expression) => onChange(expression || undefined)}
          helperText="ARC expression · quote literal text here"
        />
      )}
      {mode === "default" && (
        <p className="muted-copy">
          {helperText ||
            "Uses the callee’s default or data source when available."}
        </p>
      )}
    </div>
  );
}
